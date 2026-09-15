.DEFAULT_GOAL := help

.PHONY: help install dev frontend build check rust-check fmt fmt-check exe installer

help: ## Show available development commands
	@echo Available commands:
	@echo   make install     Install JavaScript dependencies
	@echo   make dev         Run the full Tauri desktop app with hot reload
	@echo   make frontend    Run the Vite frontend only
	@echo   make check       Run TypeScript and Rust preflight checks
	@echo   make fmt         Format the Rust backend
	@echo   make fmt-check   Verify Rust formatting without changing files
	@echo   make exe         Build a release executable without an installer
	@echo   make installer   Build the Windows installer

install: ## Install JavaScript dependencies
	npm install

dev: ## Run the full Tauri desktop app with hot reload
	npm run tauri -- dev

frontend: ## Run the Vite frontend only
	npm run dev

build: ## Type-check TypeScript and build the frontend
	npm run build

rust-check: ## Compile-check the Rust backend
	cargo check --manifest-path src-tauri/Cargo.toml

check: build rust-check ## Run all preflight checks

fmt: ## Format the Rust backend
	cargo fmt --manifest-path src-tauri/Cargo.toml

fmt-check: ## Verify Rust formatting without changing files
	cargo fmt --manifest-path src-tauri/Cargo.toml --check

exe: ## Build a release executable without an installer
	npx tauri build --no-bundle

installer: ## Build the Windows installer
	npx tauri build
