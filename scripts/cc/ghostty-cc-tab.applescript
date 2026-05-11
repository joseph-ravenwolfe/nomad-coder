-- Open a Ghostty tab in a target directory and run the configured CLI.
--
-- Usage:
--   osascript ghostty-cc-tab.applescript <target-dir> [<cli-command> [<resume-session-id>]]
--
-- Args:
--   target-dir          absolute path to cd into (required)
--   cli-command         the binary to launch Claude Code (optional; default "cc")
--   resume-session-id   UUID of a session to resume via `<cli> --resume <sid>`
--                       (optional). When provided, the kickstart prompt is
--                       skipped — `--resume` rehydrates the existing session
--                       so we want it to pick up where it left off, not to
--                       re-run the SessionStart bootstrap directive.
--
-- This script is the Ghostty launcher for the bridge's `/cc` Telegram
-- command. The bridge sets CC_LAUNCH_SCRIPT to this file and CC_CLI_COMMAND
-- to whatever the operator chose at install time (e.g. "cc", "claude", or
-- a custom alias).
--
-- Sibling scripts in this directory (iterm-, terminal-, wave-, warp-) cover
-- other terminals. The contract is identical: take (target-dir, cli-command,
-- [resume-session-id]), exit 0 on success, non-zero on failure.
--
-- Behavior:
--   * If Ghostty already has at least one window, focuses it and opens a NEW TAB
--     in the frontmost window (Cmd+T).
--   * If Ghostty is not running (or has no windows), launches it, waits for
--     its first window, and uses that window's initial tab.
--   * Then types either:
--       `cd <dir> && <cli> <kickstart-prompt>`        (fresh)
--       `cd <dir> && <cli> --resume <session-id>`    (resume)
--     and presses Return.
--
-- The kickstart prompt forces the agent's first turn so the SessionStart
-- hook's bootstrap directive (injected via additionalContext) actually
-- executes. Without it, an agent launched via /cc-from-Telegram would sit
-- idle until the operator typed something — defeating the whole point of
-- launching a session remotely.

on run argv
	if (count of argv) < 1 then
		error "Usage: osascript ghostty-cc-tab.applescript <target-dir> [<cli-command> [<resume-session-id>]]"
	end if
	set targetDir to item 1 of argv
	set cliCommand to "cc"
	if (count of argv) ≥ 2 then set cliCommand to item 2 of argv
	set resumeSid to ""
	if (count of argv) ≥ 3 then set resumeSid to item 3 of argv

	if resumeSid is not "" then
		-- Resume mode: rehydrate the existing session; do not inject a kickstart.
		set ccCommand to "cd " & quoted form of targetDir & " && " & cliCommand & " --resume " & quoted form of resumeSid
	else
		set kickstart to "Run your SessionStart bootstrap directive. Reply with just: Online."
		set ccCommand to "cd " & quoted form of targetDir & " && " & cliCommand & " " & quoted form of kickstart
	end if

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
