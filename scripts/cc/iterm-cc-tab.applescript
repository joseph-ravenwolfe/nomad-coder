-- Open an iTerm2 tab in a target directory and run the configured CLI.
--
-- Usage:
--   osascript iterm-cc-tab.applescript <target-dir> [<cli-command>]
--
-- Uses iTerm2's native AppleScript dictionary (no keystroke fallback) — far
-- more reliable than synthesized typing. Tested against iTerm2 3.x.
--
-- Behavior:
--   * If iTerm has a current window, creates a new tab in it and runs the
--     command in that tab's session.
--   * If iTerm has no windows, creates one and uses its initial session.

on run argv
	if (count of argv) < 1 then
		error "Usage: osascript iterm-cc-tab.applescript <target-dir> [<cli-command>]"
	end if
	set targetDir to item 1 of argv
	set cliCommand to "cc"
	if (count of argv) ≥ 2 then set cliCommand to item 2 of argv

	set kickstart to "Run your SessionStart bootstrap directive. Reply with just: Online."
	set ccCommand to "cd " & quoted form of targetDir & " && " & cliCommand & " " & quoted form of kickstart

	tell application "iTerm"
		activate
		if (count of windows) = 0 then
			set newWin to (create window with default profile)
			tell current session of newWin
				write text ccCommand
			end tell
		else
			tell current window
				set newTab to (create tab with default profile)
				tell current session of newTab
					write text ccCommand
				end tell
			end tell
		end if
	end tell
end run
