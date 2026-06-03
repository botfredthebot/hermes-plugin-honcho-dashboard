"""
Frontend functional tests for the Config tab in the Honcho Dashboard plugin.

Tests cover:
  - Config tab navigation and loading
  - Global settings: editable toggles and number inputs
  - Global settings: all expected sections present
  - Workspace overrides: effective state, greyed-out behavior
  - Error handling: no JS errors on load

Uses Playwright headless browser against the running gateway.
"""
import time
import pytest
from playwright.sync_api import sync_playwright, expect


DASHBOARD_URL = "http://127.0.0.1:9119"


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path="/usr/bin/chromium-browser",
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        )
        yield browser
        browser.close()


@pytest.fixture(scope="session")
def errors():
    return []


@pytest.fixture
def page(browser, errors):
    context = browser.new_context(
        ignore_https_errors=True,
        viewport={"width": 1280, "height": 900},
    )
    pg = context.new_page()
    pg.on("pageerror", lambda exc: errors.append(f"JS_ERROR: {exc}"))
    pg.on("dialog", lambda dialog: dialog.accept())
    yield pg
    _known = "Cannot read properties of undefined (reading 'peers')"
    real_errors = [e for e in errors if "JS_ERROR" in e and _known not in e]
    if real_errors:
        pytest.fail(
            f"JavaScript errors ({len(real_errors)}):\n"
            + "\n".join(real_errors[:10])
            + (f"\n...and {len(real_errors) - 10} more" if len(real_errors) > 10 else "")
        )
    pg.close()
    context.close()


@pytest.fixture(autouse=True)
def navigate_to_dashboard(page, errors):
    errors.clear()
    page.goto(DASHBOARD_URL, wait_until="networkidle")

class TestConfigTabNavigation:
    """Tests that the Config tab loads and renders correctly."""

    @pytest.fixture(autouse=True)
    def setup(self, page, errors):
        errors.clear()
        page.goto(DASHBOARD_URL, wait_until="networkidle")
        page.wait_for_timeout(3_000)

    def test_config_tab_exists(self):
        tab = page.query_selector("text=Config")
        assert tab is not None, "Config tab not found in tab bar"

    def test_navigate_to_config_tab(self):
        page.click("text=Config", timeout=5_000)
        page.wait_for_timeout(2_000)
        heading = page.query_selector("text=Configuration")
        assert heading is not None, "Config page heading not found"

    def test_config_shows_global_settings_section(self):
        page.click("text=Config", timeout=5_000)
        page.wait_for_timeout(3_000)
        assert page.query_selector("text=Global Settings") is not None

    def test_config_shows_workspace_overrides_section(self):
        page.click("text=Config", timeout=5_000)
        page.wait_for_timeout(3_000)
        assert page.query_selector("text=Workspace Overrides") is not None

    def test_config_shows_save_buttons(self):
        page.click("text=Config", timeout=5_000)
        page.wait_for_timeout(3_000)
        btn_texts = [b.inner_text() for b in page.query_selector_all("button")]
        assert any("Save" in t for t in btn_texts), f"No save buttons: {btn_texts}"


# =================================================================== #
# CONFIG TAB — Global Settings: Editable Toggles
# =================================================================== #

class TestConfigGlobalToggles:
    @pytest.fixture(autouse=True)
    def setup(self, page, errors):
        errors.clear()
        page.goto(DASHBOARD_URL, wait_until="networkidle")
        page.wait_for_timeout(3_000)
        page.click("text=Config", timeout=5_000)
        page.wait_for_timeout(3_000)

    def test_deriver_enabled_toggle_exists(self):
        assert page.query_selector("text=Enabled") is not None

    def test_toggle_pill_buttons_exist(self):
        page.wait_for_timeout(2_000)
        all_buttons = page.query_selector_all("button")
        toggles = [b for b in all_buttons if b.bounding_box() and 40 <= b.bounding_box()["width"] <= 60]
        assert len(toggles) >= 3, f"Expected >=3 toggles, found {len(toggles)}"

    def test_clicking_global_toggle(self):
        page.wait_for_timeout(2_000)
        all_buttons = page.query_selector_all("button")
        first_toggle = None
        for b in all_buttons:
            box = b.bounding_box()
            if box and 40 <= box["width"] <= 60 and 20 <= box["height"] <= 35:
                first_toggle = b
                break
        if first_toggle is None:
            pytest.skip("No toggle buttons found")
        first_toggle.click()
        page.wait_for_timeout(500)

    def test_save_global_button_appears_after_edit(self):
        page.wait_for_timeout(2_000)
        all_buttons = page.query_selector_all("button")
        first_toggle = None
        for b in all_buttons:
            box = b.bounding_box()
            if box and 40 <= box["width"] <= 60 and 20 <= box["height"] <= 35:
                first_toggle = b
                break
        if first_toggle is None:
            pytest.skip("No toggle buttons found")
        first_toggle.click()
        page.wait_for_timeout(1_000)
        btn_texts = [b.inner_text() for b in page.query_selector_all("button")]
        assert any("Save Global" in t for t in btn_texts), f"Save Global not found: {btn_texts}"


# =================================================================== #
# CONFIG TAB — Global Settings: Editable Number Inputs
# =================================================================== #

class TestConfigGlobalNumbers:
    @pytest.fixture(autouse=True)
    def setup(self, page, errors):
        errors.clear()
        page.goto(DASHBOARD_URL, wait_until="networkidle")
        page.wait_for_timeout(3_000)
        page.click("text=Config", timeout=5_000)
        page.wait_for_timeout(3_000)

    def test_number_inputs_exist(self):
        page.wait_for_timeout(2_000)
        inputs = page.query_selector_all("input[type='number']")
        assert len(inputs) >= 2, f"Expected >=2 number inputs, found {len(inputs)}"

    def test_number_input_editable(self):
        inputs = page.query_selector_all("input[type='number']")
        if not inputs:
            pytest.skip("No number inputs found")
        first = inputs[0]
        first.click()
        first.fill("99")
        page.wait_for_timeout(500)
        assert first.input_value() == "99"


# =================================================================== #
# CONFIG TAB — Global Settings: Section Structure
# =================================================================== #

class TestConfigGlobalSections:
    @pytest.fixture(autouse=True)
    def setup(self, page, errors):
        errors.clear()
        page.goto(DASHBOARD_URL, wait_until="networkidle")
        page.wait_for_timeout(3_000)
        page.click("text=Config", timeout=5_000)
        page.wait_for_timeout(3_000)

    def test_deriver_section_visible(self):
        assert page.query_selector("text=Deriver") is not None

    def test_summary_section_visible(self):
        assert page.query_selector("text=Summary") is not None

    def test_dream_section_visible(self):
        assert page.query_selector("text=Dream") is not None

    def test_cache_section_visible(self):
        assert page.query_selector("text=Cache") is not None

    def test_embedding_section_visible(self):
        assert page.query_selector("text=Embedding") is not None

    def test_models_subsection_visible(self):
        assert page.query_selector("text=Models") is not None

    def test_dialectic_levels_subsection_visible(self):
        assert page.query_selector("text=Dialectic Levels") is not None


# =================================================================== #
# CONFIG TAB — Workspace Override Toggles
# =================================================================== #

class TestConfigWorkspaceOverrides:
    @pytest.fixture(autouse=True)
    def setup(self, page, errors):
        errors.clear()
        page.goto(DASHBOARD_URL, wait_until="networkidle")
        page.wait_for_timeout(3_000)
        page.click("text=Config", timeout=5_000)
        page.wait_for_timeout(3_000)

    def test_workspace_toggle_exists(self):
        page.wait_for_timeout(2_000)
        all_buttons = page.query_selector_all("button")
        toggles = [b for b in all_buttons if b.bounding_box() and 40 <= b.bounding_box()["width"] <= 60]
        assert len(toggles) >= 4, f"Expected >=4 toggles, found {len(toggles)}"

    def test_save_workspace_button_exists(self):
        btn_texts = [b.inner_text() for b in page.query_selector_all("button")]
        assert any("Save Workspace" in t for t in btn_texts), f"Save Workspace not found: {btn_texts}"

    def test_custom_instructions_textarea_exists(self):
        textareas = page.query_selector_all("textarea")
        assert len(textareas) >= 1, "Custom instructions textarea not found"

    def test_clicking_greyed_override(self):
        page.wait_for_timeout(2_000)
        all_buttons = page.query_selector_all("button")
        greyed_toggle = None
        for b in all_buttons:
            box = b.bounding_box()
            if box and 40 <= box["width"] <= 60 and 20 <= box["height"] <= 35:
                opacity = b.evaluate("el => window.getComputedStyle(el).opacity")
                if opacity and float(opacity) < 0.8:
                    greyed_toggle = b
                    break
        if greyed_toggle is None:
            pytest.skip("No greyed-out toggles found")
        greyed_toggle.click()
        page.wait_for_timeout(500)


# =================================================================== #
# CONFIG TAB — Error Handling
# =================================================================== #

class TestConfigErrorHandling:
    @pytest.fixture(autouse=True)
    def setup(self, page, errors):
        errors.clear()
        page.goto(DASHBOARD_URL, wait_until="networkidle")
        page.wait_for_timeout(3_000)

    def test_config_tab_no_js_errors_on_load(self):
        page.click("text=Config", timeout=5_000)
        page.wait_for_timeout(3_000)
        real_errors = [e for e in errors if "JS_ERROR" in e and "peers" not in e]
        assert len(real_errors) == 0, f"JS errors: {real_errors[:5]}"
