-- Open a Ghostty tab in a target directory and run `cc`.
--
-- Usage:
--   osascript ghostty-cc-tab.applescript /path/to/dir
--
-- This script is the default reference launcher for the bridge's `/cc`
-- Telegram command. Point the bridge's `CC_LAUNCH_SCRIPT` env var at the
-- absolute path of this file, e.g. in your launchd plist:
--
--   <key>CC_LAUNCH_SCRIPT</key>
--   <string>/Users/<you>/Projects/Telegram-Bridge-MCP/scripts/cc/ghostty-cc-tab.applescript</string>
--
-- Other terminals (iTerm2, Warp, Alacritty, etc.) can be supported by
-- dropping a sibling script into this directory and pointing
-- CC_LAUNCH_SCRIPT at it. The contract is: take one positional arg
-- (target dir), exit 0 on success, non-zero on failure.
--
-- Behavior:
--   * If Ghostty already has at least one window, focuses it and opens a NEW TAB
--     in the frontmost window (Cmd+T).
--   * If Ghostty is not running (or has no windows), launches it, waits for
--     its first window, and uses that window's initial tab.
--   * Then types `cd <dir> && cc` and presses Return.

on run argv
	if (count of argv) < 1 then
		error "Usage: osascript ghostty-cc-tab.applescript <target-dir>"
	end if
	set targetDir to item 1 of argv
	set ccCommand to "cd " & quoted form of targetDir & " && cc"

	-- Determine whether Ghostty already has a window before we activate it.
	set hadWindows to false
	if application "Ghostty" is running then
		tell application "System Events"
			if exists (process "Ghostty") then
				set hadWindows to ((count of windows of process "Ghostty") > 0)
			end if
		end tell
	end if

	-- Bring Ghostty to the front (launches it if not running).
	tell application "Ghostty" to activate

	-- Wait for Ghostty's process to be frontmost.
	tell application "System Events"
		repeat 30 times
			if frontmost of process "Ghostty" then exit repeat
			delay 0.1
		end repeat

		tell process "Ghostty"
			if hadWindows then
				-- Existing window: open a new tab in the frontmost window.
				keystroke "t" using command down
				-- Brief pause so the new tab's shell is ready to receive input.
				delay 0.25
			else
				-- No prior window: activation should have created one. Wait for it.
				repeat 50 times
					if (count of windows) > 0 then exit repeat
					delay 0.1
				end repeat
				-- Small grace period for the shell prompt to render.
				delay 0.25
			end if

			-- Type the cd + cc command and run it.
			keystroke ccCommand
			key code 36 -- Return
		end tell
	end tell
end run
