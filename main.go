// Command squirrel runs the Squirrel household stock counter.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/andrewmooreio/squirrel/internal/config"
	"github.com/andrewmooreio/squirrel/internal/store"
	"github.com/andrewmooreio/squirrel/internal/web"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(cfg.DBPath), 0o755); err != nil {
		return err
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := st.Migrate(ctx); err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           web.New(st),
		ReadHeaderTimeout: 10 * time.Second,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Printf("squirrel: listening on %s, database %s", cfg.Addr(), cfg.DBPath)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	log.Print("squirrel: shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
