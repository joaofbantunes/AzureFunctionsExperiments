package main

import (
	"fmt"
	"os"

	"github.com/gofiber/fiber/v2"
)

func main() {
	customHandlerPort, exists := os.LookupEnv("FUNCTIONS_CUSTOMHANDLER_PORT")
	if !exists {
		customHandlerPort = "8080"
	}

	app := fiber.New()

	app.Get("/hello-go", func(c *fiber.Ctx) error {
		return c.SendString("Hello Go!")
	})

	app.Listen(fmt.Sprintf(":%s", customHandlerPort))
}
