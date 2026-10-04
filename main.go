// Command squirrel runs the Squirrel household stock counter.
package main

import (
	"fmt"
	"os"

	"github.com/andrewmooreio/squirrel/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("squirrel: listening on", cfg.Addr())
}
