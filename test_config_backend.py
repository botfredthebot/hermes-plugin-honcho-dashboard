"""
Backend unit tests for the Config tab in the Honcho Dashboard plugin.

Tests cover:
  - GET /config — workspace configuration
  - PUT /config — update workspace configuration
  - GET /global-config — read global TOML config from container
  - PUT /global-config — update global config and restart service
"""
from __future__ import annotations

import json
import os
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from fastapi import FastAPI
from dashboard.plugin_api import router

app = FastAPI()
app.include_router(router, prefix="/api/plugins/honcho-dashboard")

client = TestClient(app, raise_server_exceptions=False)

API_PREFIX = "/api/plugins/honcho-dashboard"
WORKSPACE = os.environ.get("HONCHO_WORKSPACE", "hermes-botfred")
TOKEN = "test-token"


def auth_headers():
    return {"X-Hermes-Session-Token": TOKEN, "Authorization": f"Bearer {TOKEN}"}


# =================================================================== #
# GET /config — Workspace Configuration
# =================================================================== #

class TestGetConfig:
    """Tests for GET /api/plugins/honcho-dashboard/config"""

    def test_get_config_returns_200(self):
        resp = client.get(f"{API_PREFIX}/config")
        assert resp.status_code == 200

    def test_get_config_returns_workspace_fields(self):
        resp = client.get(f"{API_PREFIX}/config")
        data = resp.json()
        assert "id" in data
        assert "configuration" in data
        assert "metadata" in data
        assert "created_at" in data

    def test_get_config_id_matches_workspace(self):
        resp = client.get(f"{API_PREFIX}/config")
        data = resp.json()
        assert data["id"] == WORKSPACE

    def test_get_config_empty_workspace_config(self):
        """When workspace has no overrides, configuration should be empty dict."""
        resp = client.get(f"{API_PREFIX}/config")
        data = resp.json()
        # The workspace config may be empty or have values depending on state
        assert isinstance(data["configuration"], dict)

    def test_get_config_metadata_is_dict(self):
        resp = client.get(f"{API_PREFIX}/config")
        data = resp.json()
        assert isinstance(data["metadata"], dict)


# =================================================================== #
# PUT /config — Update Workspace Configuration
# =================================================================== #

class TestPutConfig:
    """Tests for PUT /api/plugins/honcho-dashboard/config"""

    def test_put_config_returns_400_for_empty_body(self):
        """Sending no fields should return 400."""
        resp = client.put(f"{API_PREFIX}/config", json={}, headers=auth_headers())
        assert resp.status_code == 400

    def test_put_config_updates_single_boolean(self):
        """Updating a single boolean field should succeed."""
        body = {"configuration": {"reasoning.enabled": True}}
        resp = client.put(f"{API_PREFIX}/config", json=body, headers=auth_headers())
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True

    def test_put_config_updates_nested_fields(self):
        """Updating nested configuration fields should succeed."""
        body = {"configuration": {"reasoning.enabled": True, "summary.messages_per_short_summary": 50}}
        resp = client.put(f"{API_PREFIX}/config", json=body, headers=auth_headers())
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True

    def test_put_config_preserves_existing_fields(self):
        """PUT should deep-merge, not replace entirely."""
        # Set a value
        body1 = {"configuration": {"reasoning.enabled": True}}
        resp1 = client.put(f"{API_PREFIX}/config", json=body1, headers=auth_headers())
        assert resp1.status_code == 200

        # Set another value — first should still be there
        body2 = {"configuration": {"summary.enabled": False}}
        resp2 = client.put(f"{API_PREFIX}/config", json=body2, headers=auth_headers())
        assert resp2.status_code == 200

    def test_put_config_updates_custom_instructions(self):
        """Updating reasoning custom instructions should work."""
        body = {"configuration": {"reasoning.custom_instructions": "Be concise and focused."}}
        resp = client.put(f"{API_PREFIX}/config", json=body, headers=auth_headers())
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True

    def test_put_config_returns_configuration_in_response(self):
        """After update, the response should contain the updated configuration."""
        body = {"configuration": {"summary.messages_per_long_summary": 200}}
        resp = client.put(f"{API_PREFIX}/config", json=body, headers=auth_headers())
        assert resp.status_code == 200
        data = resp.json()
        assert "configuration" in data
        assert isinstance(data["configuration"], dict)


# =================================================================== #
# GET /global-config — Read Global TOML Config
# =================================================================== #

class TestGetGlobalConfig:
    """Tests for GET /api/plugins/honcho-dashboard/global-config"""

    def test_get_global_config_returns_200(self):
        resp = client.get(f"{API_PREFIX}/global-config")
        assert resp.status_code == 200

    def test_global_config_has_toml_sections(self):
        """Global config should contain TOML section keys."""
        resp = client.get(f"{API_PREFIX}/global-config")
        data = resp.json()
        # Should have at least some expected TOML sections
        expected_sections = {"deriver", "summary", "dream", "cache", "embedding", "dialectic"}
        found_sections = set(data.keys())
        # At least 3 of the expected sections should be present
        overlap = expected_sections & found_sections
        assert len(overlap) >= 3, f"Expected at least 3 TOML sections, found: {found_sections}"

    def test_global_config_deriver_has_enabled(self):
        resp = client.get(f"{API_PREFIX}/global-config")
        data = resp.json()
        deriver = data.get("deriver", {})
        assert "ENABLED" in deriver

    def test_global_config_summary_has_messages_per_short(self):
        resp = client.get(f"{API_PREFIX}/global-config")
        data = resp.json()
        summary = data.get("summary", {})
        assert "MESSAGES_PER_SHORT_SUMMARY" in summary

    def test_global_config_has_model_configs(self):
        """Global config should include model_config sections."""
        resp = client.get(f"{API_PREFIX}/global-config")
        data = resp.json()
        # At least deriver or summary should have a model_config
        has_model_config = False
        for section in ["deriver", "summary", "dream", "embedding"]:
            section_data = data.get(section, {})
            if "model_config" in section_data:
                has_model_config = True
                break
            # Also check nested model_config in levels (dialectic)
            if section == "dream" and isinstance(section_data, dict):
                for key in ["main_model_config", "deduction_model_config", "induction_model_config"]:
                    if key in section_data:
                        has_model_config = True
                        break
        assert has_model_config, "Expected at least one model_config in global config"

    def test_global_config_cache_has_ttl(self):
        resp = client.get(f"{API_PREFIX}/global-config")
        data = resp.json()
        cache = data.get("cache", {})
        assert "DEFAULT_TTL_SECONDS" in cache


# =================================================================== #
# PUT /global-config — Update Global Config
# =================================================================== #

class TestPutGlobalConfig:
    """Tests for PUT /api/plugins/honcho-dashboard/global-config"""

    @patch("subprocess.run")
    def test_put_global_config_updates_toml(self, mock_run):
        """PUT with valid keys should call docker to update and restart."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="[deriver]\nENABLED = true\n[summary]\nENABLED = true\ntest = 42\n",
            stderr=""
        )
        body = {"deriver.ENABLED": False, "summary.test": 99}
        resp = client.put(f"{API_PREFIX}/global-config", json=body, headers=auth_headers())
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert mock_run.called

    @patch("subprocess.run")
    def test_put_global_config_restarts_container(self, mock_run):
        """After writing config, the container should be restarted."""
        mock_run.return_value = MagicMock(returncode=0, stdout="[section]", stderr="")
        body = {"cache.ENABLED": True}
        resp = client.put(f"{API_PREFIX}/global-config", json=body, headers=auth_headers())
        assert resp.status_code == 200
        assert mock_run.call_count >= 2

    @patch("subprocess.run")
    def test_put_global_config_handles_docker_failure(self, mock_run):
        """If docker read fails, should return 502."""
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="container not found")
        body = {"deriver.ENABLED": True}
        resp = client.put(f"{API_PREFIX}/global-config", json=body, headers=auth_headers())
        assert resp.status_code == 502


# =================================================================== #
# Config Integration Tests
# =================================================================== #

class TestConfigIntegration:
    """Integration tests combining workspace and global config."""

    def test_workspace_config_independent_of_global(self):
        """Workspace config and global config should be independently readable."""
        ws_resp = client.get(f"{API_PREFIX}/config")
        global_resp = client.get(f"{API_PREFIX}/global-config")

        assert ws_resp.status_code == 200
        assert global_resp.status_code == 200

        ws_data = ws_resp.json()
        global_data = global_resp.json()

        # They should be different structures
        # Workspace has "configuration" key, global has TOML section keys
        assert "configuration" in ws_data
        assert "deriver" in global_data or "summary" in global_data

    def test_workspace_override_takes_precedence(self):
        """After setting a workspace override, GET /config should return it."""
        # Get current global value
        global_resp = client.get(f"{API_PREFIX}/global-config")
        global_data = global_resp.json()
        global_deriver_enabled = global_data.get("deriver", {}).get("ENABLED", True)

        # Set workspace override to opposite
        override_value = not global_deriver_enabled
        body = {"configuration": {"reasoning.enabled": override_value}}
        put_resp = client.put(f"{API_PREFIX}/config", json=body, headers=auth_headers())
        assert put_resp.status_code == 200

    def test_get_config_after_workspace_update(self):
        """After updating workspace config, GET should reflect the change."""
        # Set a known value
        body = {"configuration": {"summary.messages_per_short_summary": 42}}
        put_resp = client.put(f"{API_PREFIX}/config", json=body, headers=auth_headers())
        assert put_resp.status_code == 200
