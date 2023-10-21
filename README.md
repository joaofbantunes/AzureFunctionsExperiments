# Azure Functions Experiments

Just a very simple Azure Functions project to test out some things, comparing C# (natively supported) and Go (via custom handlers).

Note: before running Pulumi, need to build the projects and put them in the right place, so the script can find them. See below for build instructions.

## Building C# (locally)

```sh
# in the csharp/src folder
dotnet publish -o ./published
```

## Building Go (locally)

```sh
# in the go/src folder
GOOS=linux GOARCH=amd64 go build -o ../bin/go-api
# then in the src folder
cp -r ./HelloGo ./bin/.
cp host.json ./bin/.
cp local.settings.json ./bin/.
```
