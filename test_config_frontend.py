"""
Frontend functional tests for the Config tab in the Honcho Dashboard plugin.

Tests cover:
  - Config tab navigation (via Honcho plugin sidebar)
  - Global settings: editable toggles and number inputs
  - Global settings: all expected sections present
  - Workspace overrides: effective state, greyed-out behavior
  - Button functionality: clicking toggles, saving changes
  - Error handling: no JS errors on load

Uses Playwright headless browser against the running gateway.
"""
import time
import pytest
from playwright.sync_api import sync_playwright, expect


DASHBOARD_URL = "http://127.0.0.1:9119"


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #

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
    """Navigate to dashboard and wait for it to be ready."""
    errors.clear()
    page.goto(DASHBOARD_URL, wait_until="networkidle")
    page.wait_for_timeout(3_000)
    try:
        page.wait_for_selector("#app-sidebar", timeout=10_000)
    except Exception:
        pytest.skip(f"Hermes Dashboard not reachable at {DASHBOARD_URL}")
    yield


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def navigate_to_honcho(page):
    """Navigate to the Honcho plugin in the sidebar."""
    page.evaluate("document.querySelector('#app-sidebar').scrollTop = 9999")
    page.wait_for_timeout(500)
    page.click("text=HONCHO", timeout=5_000)
    page.wait_for_timeout(2_000)


def navigate_to_config_tab(page):
    """Navigate to the Config subtab within the Honcho plugin."""
    navigate_to_honcho(page)
    # Use button:text-is to target the Honcho subtab button, not the Hermes sidebar "Config" link
    page.click("button:text-is('Config')", timeout=5_000)
    page.wait_for_timeout(3_000)


# =================================================================== #
# CONFIG TAB — Navigation
# =================================================================== #

class TestConfigTabNavigation:
    """Tests that the Config tab loads and renders correctly."""

    def test_config_tab_exists_in_honcho(self, page):
        """Config tab should be visible within the Honcho plugin tabs."""
        navigate_to_honcho(page)
        page.wait_for_timeout(1_000)
        tab = page.query_selector("text=Config")
        assert tab is not None, "Config tab not found in Honcho subtabs"

    def test_navigate_to_config_tab(self, page):
        """Clicking Config should show the Configuration heading."""
        navigate_to_config_tab(page)
        heading = page.query_selector("text=Configuration")
        assert heading is not None, "Config page heading 'Configuration' not found"

    def test_config_shows_global_settings_section(self, page):
        """Config page should show the Global Settings section."""
        navigate_to_config_tab(page)
        assert page.query_selector("text=Global Settings") is not None

    def test_config_shows_workspace_overrides_section(self, page):
        """Config page should show the Workspace Overrides section."""
        navigate_to_config_tab(page)
        assert page.query_selector("text=Workspace Overrides") is not None

    def test_config_shows_save_buttons(self, page):
        """Config page should have at least one Save button."""
        navigate_to_config_tab(page)
        btn_texts = [b.inner_text() for b in page.query_selector_all("button")]
        assert any("Save" in t for t in btn_texts), f"No save buttons found: {btn_texts}"


# =================================================================== #
# CONFIG TAB — Global Settings: Editable Toggles
# =================================================================== #

class TestConfigGlobalToggles:
    def test_deriver_enabled_toggle_exists(self, page):
        """The Deriver section should have an Enabled toggle."""
        navigate_to_config_tab(page)
        assert page.query_selector("text=Enabled") is not None

    def test_toggle_pill_buttons_exist(self, page):
        """There should be multiple pill-style toggle buttons."""
        navigate_to_config_tab(page)
        page.wait_for_timeout(2_000)
        all_buttons = page.query_selector_all("button")
        toggles = [b for b in all_buttons if b.bounding_box() and 40 <= b.bounding_box()["width"] <= 60]
        assert len(toggles) >= 3, f"Expected >=3 toggles, found {len(toggles)}"

    def test_clicking_global_toggle_changes_state(self, page):
        """Clicking a global toggle should visually change its state (ON->OFF or OFF->ON)."""
        navigate_to_config_tab(page)
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

        # Get initial background color
        initial_bg = first_toggle.evaluate("el => window.getComputedStyle(el).backgroundColor")
        first_toggle.click()
        page.wait_for_timeout(500)
        new_bg = first_toggle.evaluate("el => window.getComputedStyle(el).backgroundColor")
        # Background should change when toggled
        assert initial_bg != new_bg, "Toggle background color did not change after click"

    def test_save_global_button_appears_after_edit(self, page):
        """After editing a global setting, 'Save Global Changes' button should appear."""
        navigate_to_config_tab(page)
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

    def test_clicking_toggle_twice_reverts_state(self, page):
        """Clicking a toggle twice should revert it to the original state."""
        navigate_to_config_tab(page)
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

        initial_bg = first_toggle.evaluate("el => window.getComputedStyle(el).backgroundColor")
        first_toggle.click()
        page.wait_for_timeout(500)
        first_toggle.click()
        page.wait_for_timeout(500)
        final_bg = first_toggle.evaluate("el => window.getComputedStyle(el).backgroundColor")
        assert initial_bg == final_bg, "Toggle did not revert to original state after double-click"


# =================================================================== #
# CONFIG TAB — Global Settings: Editable Number Inputs
# =================================================================== #

class TestConfigGlobalNumbers:
    def test_number_inputs_exist(self, page):
        """Global settings should have number inputs for integer values."""
        navigate_to_config_tab(page)
        page.wait_for_timeout(2_000)
        inputs = page.query_selector_all("input[type='number']")
        assert len(inputs) >= 2, f"Expected >=2 number inputs, found {len(inputs)}"

    def test_number_input_editable(self, page):
        """Number inputs should accept typed values."""
        navigate_to_config_tab(page)
        inputs = page.query_selector_all("input[type='number']")
        if not inputs:
            pytest.skip("No number inputs found")
        first = inputs[0]
        first.click()
        first.fill("99")
        page.wait_for_timeout(500)
        assert first.input_value() == "99"

    def test_number_input_save_button_appears_after_edit(self, page):
        """After editing a number input, Save Global Changes should appear."""
        navigate_to_config_tab(page)
        inputs = page.query_selector_all("input[type='number']")
        if not inputs:
            pytest.skip("No number inputs found")
        first = inputs[0]
        first.click()
        first.fill("77")
        page.wait_for_timeout(1_000)
        btn_texts = [b.inner_text() for b in page.query_selector_all("button")]
        assert any("Save Global" in t for t in btn_texts), f"Save Global not found after number edit: {btn_texts}"


# =================================================================== #
# CONFIG TAB — Global Settings: Section Structure
# =================================================================== #

class TestConfigGlobalSections:
    def test_deriver_section_visible(self, page):
        navigate_to_config_tab(page)
        assert page.query_selector("text=Deriver") is not None

    def test_summary_section_visible(self, page):
        navigate_to_config_tab(page)
        assert page.query_selector("text=Summary") is not None

    def test_dream_section_visible(self, page):
        navigate_to_config_tab(page)
        assert page.query_selector("text=Dream") is not None

    def test_cache_section_visible(self, page):
        navigate_to_config_tab(page)
        assert page.query_selector("text=Cache") is not None

    def test_embedding_section_visible(self, page):
        navigate_to_config_tab(page)
        assert page.query_selector("text=Embedding") is not None

    def test_models_subsection_visible(self, page):
        navigate_to_config_tab(page)
        assert page.query_selector("text=Models") is not None

    def test_dialectic_levels_subsection_visible(self, page):
        navigate_to_config_tab(page)
        assert page.query_selector("text=Dialectic Levels") is not None


# =================================================================== #
# CONFIG TAB — Workspace Override Toggles
# =================================================================== #

class TestConfigWorkspaceOverrides:
    def test_workspace_toggle_exists(self, page):
        """Workspace Overrides section should have toggle buttons."""
        navigate_to_config_tab(page)
        page.wait_for_timeout(2_000)
        all_buttons = page.query_selector_all("button")
        toggles = [b for b in all_buttons if b.bounding_box() and 40 <= b.bounding_box()["width"] <= 60]
        assert len(toggles) >= 4, f"Expected >=4 toggles total, found {len(toggles)}"

    def test_save_workspace_button_exists(self, page):
        """There should be a 'Save Workspace Overrides' button."""
        navigate_to_config_tab(page)
        btn_texts = [b.inner_text() for b in page.query_selector_all("button")]
        assert any("Save Workspace" in t for t in btn_texts), f"Save Workspace not found: {btn_texts}"

    def test_custom_instructions_textarea_exists(self, page):
        """Workspace Overrides should have a custom instructions textarea."""
        navigate_to_config_tab(page)
        textareas = page.query_selector_all("textarea")
        assert len(textareas) >= 1, "Custom instructions textarea not found"

    def test_clicking_greyed_override_creates_override(self, page):
        """Clicking a greyed-out (global-default) toggle should create a workspace override."""
        navigate_to_config_tab(page)
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
            pytest.skip("No greyed-out toggles found (all may already be overridden)")

        # Click the greyed toggle — it should become non-greyed (full opacity)
        greyed_toggle.click()
        page.wait_for_timeout(500)
        new_opacity = greyed_toggle.evaluate("el => window.getComputedStyle(el).opacity")
        assert float(new_opacity) >= 0.8, f"Greyed toggle did not become full opacity after click: {new_opacity}"

    def test_workspace_override_badge_appears_after_click(self, page):
        """After clicking a greyed toggle, an 'overridden' badge should appear."""
        navigate_to_config_tab(page)
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
        page.wait_for_timeout(1_000)
        # Check for "overridden" text in the page
        page_text = page.evaluate("document.body ? document.body.innerText : ''")
        assert "overridden" in page_text.lower(), "No 'overridden' badge found after clicking greyed toggle"


# =================================================================== #
# CONFIG TAB — Error Handling
# =================================================================== #

class TestConfigErrorHandling:
    def test_config_tab_no_js_errors_on_load(self, page, errors):
        """Navigating to Config tab should not produce JS errors."""
        navigate_to_config_tab(page)
        real_errors = [e for e in errors if "JS_ERROR" in e and "peers" not in e]
        assert len(real_errors) == 0, f"JS errors on Config tab load: {real_errors[:5]}"
