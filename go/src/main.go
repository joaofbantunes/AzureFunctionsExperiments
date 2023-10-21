package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func main() {
	log.Println("hello!")

	customHandlerPort, exists := os.LookupEnv("FUNCTIONS_CUSTOMHANDLER_PORT")
	if !exists {
		customHandlerPort = "8080"
	}
	r := gin.Default()
	r.GET("/hello-go", func(c *gin.Context) {
		c.String(http.StatusOK, "Hello Go!")
		// c.JSON(http.StatusOK, gin.H{
		// 	"message": "pong",
		// })
	})
	r.GET("/api/HelloGo", func(c *gin.Context) {
		c.String(http.StatusOK, "meh!")
	})
	r.Run(fmt.Sprintf(":%s", customHandlerPort))

}
