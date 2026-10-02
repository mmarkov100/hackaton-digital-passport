--liquibase formatted sql
--changeset codex:1
CREATE TABLE IF NOT EXISTS passport_projects (
    id VARCHAR(80) PRIMARY KEY,
    customer_org VARCHAR(120) NOT NULL,
    factory_org VARCHAR(120),
    body TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS passport_audit (
    id BIGSERIAL PRIMARY KEY,
    project_id VARCHAR(80) NOT NULL REFERENCES passport_projects(id),
    actor VARCHAR(80) NOT NULL,
    organization VARCHAR(120) NOT NULL,
    action VARCHAR(80) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    details TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS passport_audit_project_time ON passport_audit(project_id, occurred_at DESC);

--changeset codex:2
CREATE TABLE IF NOT EXISTS passport_files (
    id UUID PRIMARY KEY,
    project_id VARCHAR(80) NOT NULL REFERENCES passport_projects(id),
    file_name VARCHAR(255) NOT NULL,
    media_type VARCHAR(80) NOT NULL,
    body BYTEA NOT NULL,
    actor VARCHAR(80) NOT NULL,
    organization VARCHAR(120) NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS passport_files_project ON passport_files(project_id);

--changeset codex:3
CREATE TABLE IF NOT EXISTS passport_ifc_versions (
    id UUID PRIMARY KEY,
    project_id VARCHAR(80) NOT NULL REFERENCES passport_projects(id),
    file_name VARCHAR(255) NOT NULL,
    body BYTEA NOT NULL,
    actor VARCHAR(80) NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS passport_ifc_project ON passport_ifc_versions(project_id);
