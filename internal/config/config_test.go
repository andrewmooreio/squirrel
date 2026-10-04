package config_test

import (
	"testing"

	"github.com/andrewmooreio/squirrel/internal/config"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("SQUIRREL_HOST", "")
	t.Setenv("SQUIRREL_PORT", "")
	t.Setenv("SQUIRREL_DB_PATH", "")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Host != "0.0.0.0" || cfg.Port != 8080 || cfg.DBPath != "/data/squirrel.db" {
		t.Errorf("unexpected defaults: %+v", cfg)
	}
	if got := cfg.Addr(); got != "0.0.0.0:8080" {
		t.Errorf("Addr() = %q", got)
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("SQUIRREL_HOST", "127.0.0.1")
	t.Setenv("SQUIRREL_PORT", "9000")
	t.Setenv("SQUIRREL_DB_PATH", "/tmp/s.db")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Host != "127.0.0.1" || cfg.Port != 9000 || cfg.DBPath != "/tmp/s.db" {
		t.Errorf("overrides not applied: %+v", cfg)
	}
}

func TestLoadInvalidPort(t *testing.T) {
	for _, port := range []string{"abc", "0", "65536", "-1", "80x"} {
		t.Run(port, func(t *testing.T) {
			t.Setenv("SQUIRREL_PORT", port)
			if _, err := config.Load(); err == nil {
				t.Errorf("expected error for port %q", port)
			}
		})
	}
}
