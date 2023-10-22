import * as pulumi from "@pulumi/pulumi";
import * as resources from "@pulumi/azure-native/resources";
import * as web from "@pulumi/azure-native/web";
import * as storage from "@pulumi/azure-native/storage";
import * as insights from "@pulumi/azure-native/insights";
import * as operationalinsights from "@pulumi/azure-native/operationalinsights";
import * as authorization from "@pulumi/azure-native/authorization";
import * as managedidentity from "@pulumi/azure-native/managedidentity";

const resourceGroup = new resources.ResourceGroup(
  "azure-functions-experiments"
);

const appInsightsWorkspace = new operationalinsights.Workspace(
  "appInsightsWorkspace",
  {
    resourceGroupName: resourceGroup.name,
    sku: {
      name: operationalinsights.WorkspaceSkuNameEnum.Standalone,
    },
  }
);

const appInsights = new insights.Component("appInsights", {
  applicationType: insights.ApplicationType.Web,
  kind: "web",
  resourceGroupName: resourceGroup.name,
  workspaceResourceId: appInsightsWorkspace.id,
});

const storageAccount = new storage.StorageAccount("fnsa", {
  resourceGroupName: resourceGroup.name,
  kind: storage.Kind.StorageV2,
  sku: {
    name: storage.SkuName.Standard_LRS,
  },
});

// az role definition list --name "Storage Blob Data Reader" --output json
// 2a2b9908-6ea1-4ae2-8e65-a410df84e7d1
// az role definition list --name "Storage Blob Data Owner" --output json
// b7e6dc6d-f1e8-4753-8033-0f276bb0955b
// using owner so the function can also write to storage (i.e. for AzureWebJobsStorage__accountName, see link below),
// but should use reader if we only need to download the package
// https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference?tabs=blob&pivots=programming-language-csharp#connecting-to-host-storage-with-an-identity
const storageAccountReadRoleDefinition = authorization.getRoleDefinitionOutput({
  roleDefinitionId: "b7e6dc6d-f1e8-4753-8033-0f276bb0955b",
  scope: storageAccount.id,
});

const plan = new web.AppServicePlan("appservice-plan", {
  resourceGroupName: resourceGroup.name,
  sku: {
    name: "Y1",
    tier: "Dynamic",
  },
  kind: "Linux",
  // for Linux, we need to change the plan to have reserved = true ¯\_(ツ)_/¯
  reserved: true,
});

const container = new storage.BlobContainer("artifact-container", {
  accountName: storageAccount.name,
  resourceGroupName: resourceGroup.name,
  publicAccess: storage.PublicAccess.None,
});

const goBlob = new storage.Blob("goBlob", {
  resourceGroupName: resourceGroup.name,
  accountName: storageAccount.name,
  containerName: container.name,
  source: new pulumi.asset.FileArchive("../go/bin"),
});

const goBlobUrl = signedBlobReadUrl(
  goBlob,
  container,
  storageAccount,
  resourceGroup
);

const storageConnectionString = getConnectionString(
  resourceGroup.name,
  storageAccount.name
);

const goApi = new web.WebApp("go-api", {
  resourceGroupName: resourceGroup.name,
  serverFarmId: plan.id,
  kind: "FunctionApp",
  siteConfig: {
    appSettings: [
      { name: "AzureWebJobsStorage", value: storageConnectionString },
      { name: "FUNCTIONS_WORKER_RUNTIME", value: "custom" },
      { name: "WEBSITE_RUN_FROM_PACKAGE", value: goBlobUrl },
      { name: "FUNCTIONS_EXTENSION_VERSION", value: "~4" },
      {
        name: "APPLICATIONINSIGHTS_CONNECTION_STRING",
        value: pulumi.interpolate`InstrumentationKey=${appInsights.instrumentationKey}`,
      },
    ],
    functionAppScaleLimit: 1,
  },
});

const csharpBlob = new storage.Blob("csharpBlob", {
  resourceGroupName: resourceGroup.name,
  accountName: storageAccount.name,
  containerName: container.name,
  source: new pulumi.asset.FileArchive("../csharp/published"),
});

const csharpBlobUrl = unsignedBlobReadUrl(
  csharpBlob,
  container,
  storageAccount
);

const csharpManagedIdentity = new managedidentity.UserAssignedIdentity(
  "csharp-managed-identity",
  {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
  }
);

const storageAccountCsharpReadRoleAssignment = new authorization.RoleAssignment(
  "csharp-role-assignment",
  {
    roleDefinitionId: storageAccountReadRoleDefinition.id,
    principalId: csharpManagedIdentity.principalId,
    scope: storageAccount.id,
    principalType: authorization.PrincipalType.ServicePrincipal,
  }
);

const csharpApi = new web.WebApp("csharp-api", {
  resourceGroupName: resourceGroup.name,
  serverFarmId: plan.id,
  // this is used for the function to use to access services, but it doesn't work to download the binaries from blob storage
  // to download the binaries from blob storage, we need to set WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID
  // https://learn.microsoft.com/en-us/azure/app-service/deploy-run-package#access-a-package-in-azure-blob-storage-using-a-managed-identity
  identity: {
    type: "UserAssigned",
    userAssignedIdentities: [csharpManagedIdentity.id],
  },
  kind: "FunctionApp",
  siteConfig: {
    appSettings: [
      { name: "AzureWebJobsStorage__accountName", value: storageAccount.name },
      { name: "FUNCTIONS_WORKER_RUNTIME", value: "dotnet-isolated" },
      {
        name: "WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID",
        value: csharpManagedIdentity.id,
      },
      { name: "WEBSITE_RUN_FROM_PACKAGE", value: csharpBlobUrl },
      { name: "FUNCTIONS_EXTENSION_VERSION", value: "~4" },
      {
        name: "APPLICATIONINSIGHTS_CONNECTION_STRING",
        value: pulumi.interpolate`InstrumentationKey=${appInsights.instrumentationKey}`,
      },
    ],
    functionAppScaleLimit: 1,
    linuxFxVersion: "DOTNET-ISOLATED|8.0",
  },
});

export const goEndpoint = pulumi.interpolate`https://${goApi.defaultHostName}/hello-go`;
export const csharpEndpoint = pulumi.interpolate`https://${csharpApi.defaultHostName}/hello-csharp`;

function unsignedBlobReadUrl(
  blob: storage.Blob,
  container: storage.BlobContainer,
  account: storage.StorageAccount
): pulumi.Output<string> {
  return pulumi.interpolate`https://${account.name}.blob.core.windows.net/${container.name}/${blob.name}`;
}

// example of not using this in the C# function
// keeping this here for the Go function, just to have both examples, but normally should use the same approach as with the C# function
function signedBlobReadUrl(
  blob: storage.Blob,
  container: storage.BlobContainer,
  account: storage.StorageAccount,
  resourceGroup: resources.ResourceGroup
): pulumi.Output<string> {
  const blobSAS = storage.listStorageAccountServiceSASOutput({
    accountName: account.name,
    protocols: storage.HttpProtocol.Https,
    sharedAccessExpiryTime: "2030-01-01",
    sharedAccessStartTime: "2021-01-01",
    resourceGroupName: resourceGroup.name,
    resource: storage.SignedResource.C,
    permissions: storage.Permissions.R,
    canonicalizedResource: pulumi.interpolate`/blob/${account.name}/${container.name}`,
    contentType: "application/json",
    cacheControl: "max-age=5",
    contentDisposition: "inline",
    contentEncoding: "deflate",
  });
  const token = blobSAS.serviceSasToken;
  return pulumi.interpolate`https://${account.name}.blob.core.windows.net/${container.name}/${blob.name}?${token}`;
}

function getConnectionString(
  resourceGroupName: pulumi.Input<string>,
  accountName: pulumi.Input<string>
): pulumi.Output<string> {
  // Retrieve the primary storage account key.
  const storageAccountKeys = storage.listStorageAccountKeysOutput({
    resourceGroupName,
    accountName,
  });
  const primaryStorageKey = storageAccountKeys.keys[0].value;

  // Build the connection string to the storage account.
  return pulumi.interpolate`DefaultEndpointsProtocol=https;AccountName=${accountName};AccountKey=${primaryStorageKey}`;
}
