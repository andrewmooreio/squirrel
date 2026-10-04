// Package config reads Squirrel's settings from the environment.
package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
)

// Config holds the runtime settings.
type Config struct {
	Host   string
	Port   int
	DBPath string
}

// Addr returns the listen address in host:port form.
func (c Config) Addr() string {
	return net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
}

// Load reads SQUIRREL_HOST, SQUIRREL_PORT and SQUIRREL_DB_PATH, applying
// defaults for any that are unset or empty.
func Load() (Config, error) {
	cfg := Config{
		Host:   env("SQUIRREL_HOST", "0.0.0.0"),
		DBPath: env("SQUIRREL_DB_PATH", "/data/squirrel.db"),
	}

	portStr := env("SQUIRREL_PORT", "8080")
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		return Config{}, fmt.Errorf("SQUIRREL_PORT must be a number from 1 to 65535, got %q", portStr)
	}
	cfg.Port = port

	return cfg, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
