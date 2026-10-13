#!/usr/bin/env python3
"""Black-box Venera-Next release UI smoke test on an Xvfb desktop.

No Dart source instrumentation, no mock responses and no injected app state.
Only observable desktop clicks/typing, screenshots and installed-source files.
The report distinguishes a visible screenshot from a successful import.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

OUT = Path(os.environ.get("VENERA_UI_REPORT_DIR", "release-ui-report")).resolve()
OUT.mkdir(parents=True, exist_ok=True)
HOME = Path.home()
SOURCE_CATALOG = os.environ.get(
    "VENERA_SOURCE_CATALOG",
    "https://raw.githubusercontent.com/MoYangking/venera_comic_js/main/index.json",
)
EXE = os.environ.get("VENERA_EXE", "venera-next")
records = []
app_pid = None
tree_dump = []
desktop_reachable = False
screen_count = 0


def mark(step, status, detail="", extra=None):
    value = {"step": step, "status": status, "detail": detail, "time": int(time.time())}
    if extra is not None:
        value["extra"] = extra
    records.append(value)
    print("[%s] %s: %s" % (status, step, detail), flush=True)


def shell(args, timeout=12, check=False):
    p = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    if check and p.returncode:
        raise RuntimeError("%s exited %d: %s" % (args[0], p.returncode, p.stderr[:450]))
    return p.stdout.strip()


def snap(name):
    global screen_count
    screen_count += 1
    out = OUT / ("%02d-%s.png" % (screen_count, name))
    try:
        shell(["scrot", "-z", str(out)], timeout=15, check=True)
        mark("screenshot." + name, "PASS", "%s (%d bytes)" % (out.name, out.stat().st_size))
    except Exception as e:
        mark("screenshot." + name, "FAIL", str(e)[:180])
    return out


def visible_windows():
    try:
        return shell(["wmctrl", "-lx"], timeout=8)
    except Exception:
        return ""


def click_point(x, y):
    shell(["xdotool", "mousemove", "--sync", str(int(x)), str(int(y))], check=True)
    shell(["xdotool", "click", "--clearmodifiers", "1"], check=True)
    time.sleep(1.7)


def key(k):
    shell(["xdotool", "key", "--clearmodifiers", k], check=True)
    time.sleep(0.5)


def type_text(text):
    shell(["xdotool", "type", "--clearmodifiers", "--delay", "2", text], timeout=25, check=True)
    time.sleep(1)


def scroll_down(steps=2):
    for _ in range(steps):
        shell(["xdotool", "click", "5"], timeout=6)
    time.sleep(0.8)


def _walk(node, depth, seen, result):
    if depth > 19 or len(result) >= 1400:
        return
    try:
        role = str(node.getRoleName() or "")
        name = str(node.name or "").replace("\n", " ").strip()
        count = min(node.childCount, 120)
    except Exception:
        return
    if (name or role in ("application", "frame", "dialog", "window", "push button", "text", "entry")):
        bounds = None
        actions = []
        try:
            c = node.queryComponent()
            r = c.getExtents(0)
            bounds = [int(r.x), int(r.y), int(r.width), int(r.height)]
        except Exception:
            pass
        try:
            a = node.queryAction()
            actions = [a.getName(i) for i in range(a.nActions)]
        except Exception:
            pass
        result.append({"depth": depth, "name": name[:100], "role": role,
                       "bounds": bounds, "actions": actions, "_node": node})
    for i in range(count):
        try:
            child = node.getChildAtIndex(i)
            _walk(child, depth + 1, seen, result)
        except Exception:
            continue


def accessibility():
    global desktop_reachable
    try:
        import pyatspi
        desktop = pyatspi.Registry.getDesktop(0)
        found = []
        for i in range(min(desktop.childCount, 16)):
            app = desktop.getChildAtIndex(i)
            if "venera" in str(app.name or "").lower():
                _walk(app, 0, set(), found)
        if found:
            desktop_reachable = True
        return found
    except Exception as e:
        mark("accessibility", "INFO", type(e).__name__ + ": " + str(e)[:140])
        return []


def dump_access(stage):
    entries = accessibility()
    safe = [{k: v for k, v in p.items() if k != "_node"} for p in entries]
    (OUT / ("accessibility-" + stage + ".json")).write_text(
        json.dumps(safe, indent=2, ensure_ascii=False), encoding="utf-8")
    # Do not dump arbitrary on-screen work titles to logs; just key controls.
    matches = [p for p in safe if any(s in p["name"].lower() for s in
        ("comic source", "add source", "install", "detect and preview", "repository",
         "explore", "search", "home", "rank", "read", "download"))]
    print("ACCESS %s elements=%d key-controls=%s" %
          (stage, len(safe), json.dumps(matches[:25], ensure_ascii=False)[:2500]), flush=True)
    return entries


def click_named(names, exact=False, tries=2):
    for _ in range(tries):
        candidates = []
        for item in accessibility():
            name = item["name"].casefold()
            if not name:
                continue
            for n in names:
                n = n.casefold()
                if (name == n if exact else n in name):
                    bbox = item["bounds"]
                    if bbox and bbox[2] >= 12 and bbox[3] >= 12 and bbox[0] >= 0 and bbox[1] >= 0:
                        clickable = bool(item["actions"])
                        candidates.append((not clickable, abs(len(name) - len(n)), item))
                    break
        candidates.sort(key=lambda x: (x[0], x[1]))
        if candidates:
            obj = candidates[0][2]
            x, y, w, h = obj["bounds"]
            click_point(x + w / 2, y + h / 2)
            mark("click." + names[0], "PASS", "clicked accessible %s (%s)" % (obj["role"], obj["name"]))
            return True
        time.sleep(0.7)
    return False


def screenshot_after(name):
    time.sleep(2)
    snap(name)
    dump_access(name)


def find_installed():
    roots = [HOME / ".local" / "share", HOME / ".config", Path(os.environ.get("XDG_DATA_HOME", str(HOME / ".local/share")))]
    out = {}
    for root in roots:
        if not root.exists():
            continue
        for source in root.rglob("comic_source/*.js"):
            if source.name in ("nhentai.js", "ehentai.js"):
                out[source.stem] = str(source)
    return out


def wait_window(seconds=65):
    global app_pid
    end = time.time() + seconds
    while time.time() < end:
        current = visible_windows()
        if current:
            for row in current.splitlines():
                if "venera" in row.casefold():
                    wid = row.split()[0]
                    shell(["wmctrl", "-ia", wid], timeout=7)
                    shell(["wmctrl", "-ir", wid, "-e", "0,0,0,1380,850"], timeout=7)
                    time.sleep(2)
                    mark("desktop.window", "PASS", "X11 window " + wid)
                    return True
        if app_pid is not None and app_pid.poll() is not None:
            mark("desktop.window", "FAIL", "Venera process exited: " + str(app_pid.returncode))
            return False
        time.sleep(1)
    mark("desktop.window", "FAIL", "No Venera X11 window within %d seconds" % seconds)
    return False


def run():
    global app_pid
    mark("release", "INFO", os.environ.get("VENERA_RELEASE_VERSION", "unknown"))
    mark("display", "INFO", os.environ.get("DISPLAY", "missing"))
    log = (OUT / "venera-process.log").open("w", encoding="utf-8")
    app_pid = subprocess.Popen([EXE], stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    mark("desktop.process", "PASS", "official binary started, pid=%d" % app_pid.pid)
    if not wait_window():
        snap("no-window")
        return False
    screenshot_after("application-started")
    installed_before = find_installed()
    mark("installed.before", "INFO", ", ".join(installed_before) or "empty")

    if not click_named(["Comic Source", "漫画源", "漫畫源"], tries=3):
        # The source tile is often below the fold in Home.
        for i in range(10):
            shell(["xdotool", "mousemove", "750", "690"], timeout=6)
            scroll_down(3)
            if click_named(["Comic Source", "漫画源", "漫畫源"], tries=1):
                break
        else:
            mark("navigation.comic-source", "FAIL", "No accessible Comic Source action after scrolling")
            screenshot_after("source-tile-not-found")
            return False
    screenshot_after("comic-source-manager")
    if not click_named(["Add source", "添加漫画源", "添加来源", "添加源"], tries=3):
        mark("navigation.add-source", "FAIL", "Could not find Add source control")
        screenshot_after("add-source-not-found")
        return False
    screenshot_after("source-import-dialog")

    # Focus the input labelled Source link or contents; the modal's first
    # text-entry is a fallback if the accessibility tree lacks the label.
    if not click_named(["Source link or contents", "源链接", "來源連結"], tries=2):
        entries = [p for p in accessibility()
                   if p["role"].lower() in ("text", "entry", "text field")
                   and p["bounds"] and p["bounds"][2] > 230]
        entries.sort(key=lambda p: p["bounds"][2], reverse=True)
        if entries:
            x, y, w, h = entries[0]["bounds"]
            click_point(x + w / 2, y + h / 2)
            mark("input.focus", "PASS", "focused accessible text entry")
        else:
            # Standard centered 600px AlertDialog and first input position.
            click_point(690, 395)
            mark("input.focus", "INFO", "used screen-coordinate fallback")
    type_text(SOURCE_CATALOG)
    screenshot_after("catalog-url-entered")

    if not click_named(["Detect and preview", "检测并预览", "偵測並預覽"], tries=3):
        # Bottom right of the centered Material AlertDialog.
        click_point(945, 660)
        mark("import.detect", "INFO", "used screenshot-based dialog fallback point")
    time.sleep(8)
    screenshot_after("catalog-preview")

    if not click_named(["Install selected", "安装选中", "安裝所選", "Install source"], tries=2):
        mark("import.install", "FAIL", "No Install selected button; inspect catalog-preview screenshot")
        screenshot_after("install-button-missing")
        return False
    time.sleep(18)
    screenshot_after("post-install")
    present = find_installed()
    mark("installed.after", "INFO", ", ".join(present) or "empty")
    for key in ("nhentai", "ehentai"):
        mark("installed." + key, "PASS" if key in present else "FAIL",
             ("Installed source file exists" if key in present else "No installed JS file found in app data paths"))
    # Exercise the visible app UI even if a downstream network request fails.
    if click_named(["Explore", "发现", "探索"], tries=2):
        screenshot_after("explore-view")
        if click_named(["Search", "搜索"], tries=2):
            screenshot_after("search-entry")
    return all(key in present for key in ("nhentai", "ehentai"))


success = False
try:
    success = run()
except Exception as e:
    mark("harness.error", "FAIL", type(e).__name__ + ": " + str(e)[:250])
    snap("harness-exception")
finally:
    snap("final-desktop")
    if app_pid:
        try:
            app_pid.terminate()
            app_pid.wait(timeout=5)
        except Exception:
            app_pid.kill()
    payload = {
        "suite": "official Venera-Next Linux .deb desktop smoke",
        "real_client": True,
        "virtual_display": True,
        "status": "PASS" if success else "FAIL",
        "screenshots": [x.name for x in sorted(OUT.glob("*.png"))],
        "records": records,
    }
    (OUT / "results.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    rows = "\n".join("| %s | %s | %s |" % (
        r["step"], r["status"], r["detail"].replace("|", "/")) for r in records)
    (OUT / "summary.md").write_text(
        "## Venera-Next official desktop UI test\n\n"
        "Actual installed .deb under Xvfb; screenshots are genuine desktop captures. "
        "This is not an Android device and is not a Flutter unit test.\n\n"
        "**Outcome: %s**\n\n| Stage | Status | Evidence |\n|---|---|---|\n%s\n" %
        ("PASS" if success else "FAIL", rows), encoding="utf-8")
    print("FINAL UI PASS=%s SCREENSHOTS=%d" % (success, len(payload["screenshots"])), flush=True)
sys.exit(0 if success else 1)
