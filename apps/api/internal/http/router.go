package http

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	nethttp "net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/xdrop/monorepo/internal/config"
	"github.com/xdrop/monorepo/internal/service"
)

type Handler struct {
	logger  *slog.Logger
	service *service.Service
}

// NewRouter wires the public and manage APIs together with shared middleware.
func NewRouter(cfg config.Config, logger *slog.Logger, svc *service.Service) nethttp.Handler {
	handler := Handler{
		logger:  logger,
		service: svc,
	}

	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Recoverer)
	router.Use(requestLogger(logger))
	router.Use(securityHeaders)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	router.Get("/healthz", func(w nethttp.ResponseWriter, _ *nethttp.Request) {
		writeJSON(w, nethttp.StatusOK, map[string]string{"status": "ok"})
	})

	router.Route("/api/v1", func(r chi.Router) {
		r.Route("/public/transfers/{transferId}", func(public chi.Router) {
			public.Get("/", handler.getPublicTransfer)
			public.Post("/download-urls", handler.createDownloadURLs)
		})

		r.Route("/transfers", func(manage chi.Router) {
			manage.Post("/", handler.createTransfer)
			manage.Route("/{transferId}", func(transfer chi.Router) {
				transfer.Get("/", handler.getManageTransfer)
				transfer.Patch("/", handler.patchTransfer)
				transfer.Delete("/", handler.deleteTransfer)
				transfer.Get("/resume", handler.resumeTransfer)
				transfer.Post("/files", handler.registerFiles)
				transfer.Post("/upload-urls", handler.createUploadURLs)
				transfer.Post("/chunks/complete", handler.completeChunks)
				transfer.Post("/manifest", handler.putManifest)
				transfer.Post("/finalize", handler.finalizeTransfer)
			})
		})
	})

	return router
}

func (h Handler) createTransfer(w nethttp.ResponseWriter, r *nethttp.Request) {
	var request service.CreateTransferRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, err)
		return
	}

	response, err := h.service.CreateTransfer(r.Context(), clientKey(r), request)
	if err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, nethttp.StatusCreated, response)
}

func (h Handler) registerFiles(w nethttp.ResponseWriter, r *nethttp.Request) {
	var request []service.RegisterFileRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, err)
		return
	}

	if err := h.service.RegisterFiles(r.Context(), chi.URLParam(r, "transferId"), bearerToken(r), request); err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, nethttp.StatusOK, map[string]bool{"ok": true})
}

func (h Handler) createUploadURLs(w nethttp.ResponseWriter, r *nethttp.Request) {
	var request service.UploadURLRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, err)
		return
	}

	response, err := h.service.CreateUploadURLs(r.Context(), chi.URLParam(r, "transferId"), bearerToken(r), request)
	if err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, nethttp.StatusOK, map[string]any{"items": response})
}

func (h Handler) completeChunks(w nethttp.ResponseWriter, r *nethttp.Request) {
	var request []service.CompleteChunkRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, err)
		return
	}

	if err := h.service.CompleteChunks(r.Context(), chi.URLParam(r, "transferId"), bearerToken(r), request); err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, nethttp.StatusOK, map[string]bool{"ok": true})
}

func (h Handler) putManifest(w nethttp.ResponseWriter, r *nethttp.Request) {
	var request service.ManifestUploadRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, err)
		return
	}

	if err := h.service.PutManifest(r.Context(), chi.URLParam(r, "transferId"), bearerToken(r), request); err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, nethttp.StatusOK, map[string]bool{"ok": true})
}

func (h Handler) finalizeTransfer(w nethttp.ResponseWriter, r *nethttp.Request) {
	var request service.FinalizeTransferRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, err)
		return
	}

	if err := h.service.FinalizeTransfer(r.Context(), chi.URLParam(r, "transferId"), bearerToken(r), request); err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, nethttp.StatusOK, map[string]bool{"ok": true})
}

func (h Handler) getManageTransfer(w nethttp.ResponseWriter, r *nethttp.Request) {
	response, err := h.service.GetManageTransfer(r.Context(), chi.URLParam(r, "transferId"), bearerToken(r))
	if err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, nethttp.StatusOK, response)
}

func (h Handler) patchTransfer(w nethttp.ResponseWriter, r *nethttp.Request) {
	var request service.UpdateTransferRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, err)
		return
	}

	if err := h.service.UpdateTransfer(r.Context(), chi.URLParam(r, "transferId"), bearerToken(r), request); err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, nethttp.StatusOK, map[string]bool{"ok": true})
}

func (h Handler) deleteTransfer(w nethttp.ResponseWriter, r *nethttp.Request) {
	if err := h.service.DeleteTransfer(r.Context(), chi.URLParam(r, "transferId"), bearerToken(r)); err != nil {
		writeError(w, err)
		return
	}

	w.WriteHeader(nethttp.StatusNoContent)
}

func (h Handler) resumeTransfer(w nethttp.ResponseWriter, r *nethttp.Request) {
	response, err := h.service.ResumeTransfer(r.Context(), chi.URLParam(r, "transferId"), bearerToken(r))
	if err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, nethttp.StatusOK, response)
}

func (h Handler) getPublicTransfer(w nethttp.ResponseWriter, r *nethttp.Request) {
	response, err := h.service.GetPublicTransfer(r.Context(), clientKey(r), chi.URLParam(r, "transferId"))
	if err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, nethttp.StatusOK, response)
}

func (h Handler) createDownloadURLs(w nethttp.ResponseWriter, r *nethttp.Request) {
	var request service.DownloadURLRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, err)
		return
	}

	response, err := h.service.CreateDownloadURLs(r.Context(), clientKey(r), chi.URLParam(r, "transferId"), request)
	if err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, nethttp.StatusOK, map[string]any{"items": response})
}

// decodeJSON enforces a single JSON value and rejects unknown fields for stricter contracts.
func decodeJSON(r *nethttp.Request, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return &service.HTTPError{Status: nethttp.StatusBadRequest, Code: "invalid_json", Message: err.Error()}
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return &service.HTTPError{Status: nethttp.StatusBadRequest, Code: "invalid_json", Message: "request body must contain a single JSON value"}
	}

	return nil
}

// writeJSON serializes a response body with the expected JSON content type.
func writeJSON(w nethttp.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

// writeError translates service-layer HTTP errors into JSON API responses.
func writeError(w nethttp.ResponseWriter, err error) {
	var httpErr *service.HTTPError
	if errors.As(err, &httpErr) {
		writeJSON(w, httpErr.Status, map[string]string{
			"error":   httpErr.Code,
			"message": httpErr.Message,
		})
		return
	}

	writeJSON(w, nethttp.StatusInternalServerError, map[string]string{
		"error":   "internal_error",
		"message": "internal server error",
	})
}

func bearerToken(r *nethttp.Request) string {
	value := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(strings.ToLower(value), "bearer ") {
		return ""
	}

	return strings.TrimSpace(value[7:])
}

func clientKey(r *nethttp.Request) string {
	value := strings.TrimSpace(r.RemoteAddr)
	if value == "" {
		return ""
	}
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		return strings.TrimSpace(host)
	}

	return value
}

// securityHeaders adds a baseline set of defensive response headers to every request.
func securityHeaders(next nethttp.Handler) nethttp.Handler {
	return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-site")
		next.ServeHTTP(w, r)
	})
}

// requestLogger records lightweight request metadata without buffering response bodies.
func requestLogger(logger *slog.Logger) func(nethttp.Handler) nethttp.Handler {
	return func(next nethttp.Handler) nethttp.Handler {
		return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
			startedAt := time.Now()
			next.ServeHTTP(w, r)
			logger.Info("request complete",
				"method", r.Method,
				"path", r.URL.Path,
				"remote_addr", r.RemoteAddr,
				"duration_ms", time.Since(startedAt).Milliseconds(),
			)
		})
	}
}
