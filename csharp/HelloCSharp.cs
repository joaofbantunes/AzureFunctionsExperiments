using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace AzureFunctionsExperiments.CSharp
{
    public class HelloCSharp
    {
        private readonly ILogger _logger;

        public HelloCSharp(ILoggerFactory loggerFactory)
        {
            _logger = loggerFactory.CreateLogger<HelloCSharp>();
        }

        [Function("hello-csharp")]
        public HttpResponseData Run([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post")] HttpRequestData req)
        {
            _logger.LogInformation("C# HTTP trigger function processed a request.");

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "text/plain; charset=utf-8");

            response.WriteString("Hello C#");

            return response;
        }
    }
}
