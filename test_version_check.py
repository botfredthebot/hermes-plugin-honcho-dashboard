"""
Backend unit tests for the version check and update endpoints.

Tests cover:
  - GET /version-check — compare installed vs latest version
  - POST /update — pull latest image + restart container
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
TOKEN = "test-token"


def auth_headers():
    return {"X-Hermes-Session-Token": TOKEN, "Authorization": f"Bearer {TOKEN}"}


# =================================================================== #
# GET /version-check — Version Comparison
# =================================================================== #

class TestVersionCheck:
    """Tests for GET /api/plugins/honcho-dashboard/version-check"""

    @patch("dashboard.plugin_api._get_installed_version")
    @patch("dashboard.plugin_api._get_latest_version")
    def test_version_check_up_to_date(self, mock_latest, mock_installed):
        """When installed == latest, update_available should be False."""
        mock_installed.return_value = "3.0.7"
        mock_latest.return_value = "3.0.7"
        resp = client.get(f"{API_PREFIX}/version-check")
        assert resp.status_code == 200
        data = resp.json()
        assert data["installed"] == "3.0.7"
        assert data["latest"] == "3.0.7"
        assert data["update_available"] is False
        assert "Up to date" in data["message"]

    @patch("dashboard.plugin_api._get_installed_version")
    @patch("dashboard.plugin_api._get_latest_version")
    def test_version_check_update_available(self, mock_latest, mock_installed):
        """When latest > installed, update_available should be True."""
        mock_installed.return_value = "3.0.7"
        mock_latest.return_value = "3.1.0"
        resp = client.get(f"{API_PREFIX}/version-check")
        assert resp.status_code == 200
        data = resp.json()
        assert data["installed"] == "3.0.7"
        assert data["latest"] == "3.1.0"
        assert data["update_available"] is True
        assert "Update available" in data["message"]

    @patch("dashboard.plugin_api._get_installed_version")
    def test_version_check_installed_none(self, mock_installed):
        """When installed version can't be determined, should return 502."""
        mock_installed.return_value = None
        resp = client.get(f"{API_PREFIX}/version-check")
        assert resp.status_code == 502

    @patch("dashboard.plugin_api._get_installed_version")
    @patch("dashboard.plugin_api._get_latest_version")
    def test_version_check_latest_none(self, mock_latest, mock_installed):
        """When latest can't be determined, update_available should be None."""
        mock_installed.return_value = "3.0.7"
        mock_latest.return_value = None
        resp = client.get(f"{API_PREFIX}/version-check")
        assert resp.status_code == 200
        data = resp.json()
        assert data["installed"] == "3.0.7"
        assert data["latest"] is None
        assert data["update_available"] is None
        assert "Could not check" in data["message"]

    @patch("dashboard.plugin_api._get_installed_version")
    @patch("dashboard.plugin_api._get_latest_version")
    def test_version_check_semver_comparison(self, mock_latest, mock_installed):
        """Version comparison should use semver, not string comparison."""
        mock_installed.return_value = "3.0.9"
        mock_latest.return_value = "3.0.10"
        resp = client.get(f"{API_PREFIX}/version-check")
        assert resp.status_code == 200
        data = resp.json()
        assert data["update_available"] is True

    @patch("dashboard.plugin_api._get_installed_version")
    @patch("dashboard.plugin_api._get_latest_version")
    def test_version_check_older_latest(self, mock_latest, mock_installed):
        """When latest < installed (e.g. dev build), update_available should be False."""
        mock_installed.return_value = "3.1.0"
        mock_latest.return_value = "3.0.7"
        resp = client.get(f"{API_PREFIX}/version-check")
        assert resp.status_code == 200
        data = resp.json()
        assert data["update_available"] is False

    @patch("dashboard.plugin_api._get_installed_version")
    @patch("dashboard.plugin_api._get_latest_version")
    def test_version_check_local_only_image(self, mock_latest, mock_installed):
        """For local-only images, latest == installed, so update_available is False."""
        mock_installed.return_value = "3.8.7"
        mock_latest.return_value = "3.8.7"
        resp = client.get(f"{API_PREFIX}/version-check")
        assert resp.status_code == 200
        data = resp.json()
        assert data["installed"] == "3.8.7"
        assert data["latest"] == "3.8.7"
        assert data["update_available"] is False
        assert "Up to date" in data["message"]


# =================================================================== #
# POST /update — Pull + Restart
# =================================================================== #

class TestUpdateEndpoint:
    """Tests for POST /api/plugins/honcho-dashboard/update"""

    @patch("dashboard.plugin_api._get_installed_version")
    @patch("subprocess.run")
    def test_update_pulls_then_restarts(self, mock_run, mock_version):
        """Update should call docker pull then docker restart."""
        mock_run.return_value = MagicMock(returncode=0, stdout="Status: Image is up to date", stderr="")
        mock_version.return_value = "3.0.7"
        resp = client.post(f"{API_PREFIX}/update")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["updated"] is False
        # Should have called pull + restart (2 subprocess calls)
        assert mock_run.call_count == 2
        # First call should be docker pull
        first_call = mock_run.call_args_list[0]
        assert "pull" in first_call[0][0]
        # Second call should be docker restart
        second_call = mock_run.call_args_list[1]
        assert "restart" in second_call[0][0]

    @patch("dashboard.plugin_api._get_installed_version")
    @patch("subprocess.run")
    def test_update_with_new_version(self, mock_run, mock_version):
        """When pull downloads a new image, updated should be True."""
        # First call (pull) returns "Downloaded newer image"
        pull_result = MagicMock(returncode=0, stdout="Downloaded newer image for honcho-api:latest", stderr="")
        restart_result = MagicMock(returncode=0, stdout="", stderr="")
        mock_run.side_effect = [pull_result, restart_result]
        mock_version.return_value = "3.1.0"
        resp = client.post(f"{API_PREFIX}/update")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["updated"] is True
        assert data["version"] == "3.1.0"

    @patch("subprocess.run")
    def test_update_pull_failure(self, mock_run):
        """When docker pull fails, should return 502."""
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="pull access denied")
        resp = client.post(f"{API_PREFIX}/update")
        assert resp.status_code == 502

    @patch("dashboard.plugin_api._get_installed_version")
    @patch("subprocess.run")
    def test_update_restart_failure(self, mock_run, mock_version):
        """When docker restart fails, should return 502."""
        pull_result = MagicMock(returncode=0, stdout="Status: Image is up to date", stderr="")
        restart_result = MagicMock(returncode=1, stdout="", stderr="Error: No such container")
        mock_run.side_effect = [pull_result, restart_result]
        resp = client.post(f"{API_PREFIX}/update")
        assert resp.status_code == 502

    @patch("subprocess.run")
    def test_update_timeout(self, mock_run):
        """When docker command times out, should return 504."""
        import subprocess
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="docker", timeout=120)
        resp = client.post(f"{API_PREFIX}/update")
        assert resp.status_code == 504


# =================================================================== #
# _get_installed_version — Helper
# =================================================================== #

class TestGetInstalledVersion:
    """Tests for the _get_installed_version helper."""

    @patch("subprocess.run")
    def test_reads_version_from_pyproject(self, mock_run):
        """Should parse version from pyproject.toml output."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout='[project]\nname = "honcho"\nversion = "3.0.7"\n',
            stderr=""
        )
        from dashboard.plugin_api import _get_installed_version
        result = _get_installed_version()
        assert result == "3.0.7"

    @patch("subprocess.run")
    def test_returns_none_on_error(self, mock_run):
        """Should return None when docker exec fails."""
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="error")
        from dashboard.plugin_api import _get_installed_version
        result = _get_installed_version()
        assert result is None

    @patch("subprocess.run")
    def test_returns_none_on_exception(self, mock_run):
        """Should return None on exception."""
        mock_run.side_effect = Exception("docker not found")
        from dashboard.plugin_api import _get_installed_version
        result = _get_installed_version()
        assert result is None


# =================================================================== #
# _get_latest_version — Local-only image handling
# =================================================================== #

class TestGetLatestVersion:
    """Tests for the _get_latest_version helper."""

    @patch("dashboard.plugin_api._get_installed_version", return_value="3.0.7")
    @patch("subprocess.run")
    def test_local_only_image_returns_installed(self, mock_run, mock_installed):
        """When docker pull fails with 'pull access denied', should return installed version."""
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="Error response from daemon: pull access denied for honcho-api, repository does not exist"
        )
        from dashboard.plugin_api import _get_latest_version
        result = _get_latest_version()
        # Should return the installed version since it's a local-only image
        assert result == "3.0.7"

    @patch("dashboard.plugin_api._get_installed_version", return_value="3.0.7")
    @patch("subprocess.run")
    def test_repository_not_found_returns_installed(self, mock_run, mock_installed):
        """When docker pull fails with 'repository does not exist', should return installed."""
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="Error: repository honcho-api not found"
        )
        from dashboard.plugin_api import _get_latest_version
        result = _get_latest_version()
        assert result == "3.0.7"

    @patch("subprocess.run")
    def test_network_error_returns_none(self, mock_run):
        """When docker pull fails with a network error, should return None."""
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="Error response from daemon: Get https://registry-1.docker.io/v2/: net/http: request canceled"
        )
        from dashboard.plugin_api import _get_latest_version
        result = _get_latest_version()
        assert result is None

    @patch("subprocess.run")
    def test_timeout_returns_none(self, mock_run):
        """When docker pull times out, should return None."""
        import subprocess
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="docker", timeout=120)
        from dashboard.plugin_api import _get_latest_version
        result = _get_latest_version()
        assert result is None

    @patch("dashboard.plugin_api._get_installed_version", return_value="3.0.7")
    @patch("subprocess.run")
    def test_pull_success_up_to_date(self, mock_run, mock_installed):
        """When docker pull succeeds and image is up to date, should return installed version."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="Status: Image is up to date for honcho-api:latest",
            stderr=""
        )
        from dashboard.plugin_api import _get_latest_version
        result = _get_latest_version()
        assert result == "3.0.7"

    @patch("dashboard.plugin_api._get_installed_version", return_value="3.1.0")
    @patch("subprocess.run")
    def test_pull_success_new_image(self, mock_run, mock_installed):
        """When docker pull downloads a new image, should return new version."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="Downloaded newer image for honcho-api:latest",
            stderr=""
        )
        from dashboard.plugin_api import _get_latest_version
        result = _get_latest_version()
        assert result == "3.1.0"
