-- Open a Warp tab in a target directory and run the configured CLI.
--
-- Usage:
--   osascript warp-cc-tab.applescript <target-dir> [<cli-command> [<resume-session-id>]]
--
-- When resume-session-id is provided, runs `<cli> --resume <sid>` instead
-- of the kickstart-prompt fresh-launch — used by the bridge's /cc "Resume"
-- picker.
--
-- Warp (https://www.warp.dev/) has no AppleScript dictionary as of this
-- writing, so this script uses System Events keystroke synthesis: activate
-- Warp, send Cmd+T to open a new tab, then type `cd <dir> && <cli> ...`.
--
-- If Warp changes its new-tab shortcut, set it back to Cmd+T in Warp's
-- keybindings (Settings → Features → Custom Keybindings), or fork this
-- script.

on run argv
	if (count of argv) < 1 then
		error "Usage: osascript warp-cc-tab.applescript <target-dir> [<cli-command> [<resume-session-id>]]"
	end if
	set targetDir to item 1 of argv
	set cliCommand to "cc"
	if (count of argv) ≥ 2 then set cliCommand to item 2 of argv
	set resumeSid to ""
	if (count of argv) ≥ 3 then set resumeSid to item 3 of argv

	if resumeSid is not "" then
		set ccCommand to "cd " & quoted form of targetDir & " && " & cliCommand & " --resume " & quoted form of resumeSid
	else
		set kickstart to "Run your SessionStart bootstrap directive. Reply with just: Online."
		set ccCommand to "cd " & quoted form of targetDir & " && " & cliCommand & " " & quoted form of kickstart
	end if

	-- Did Warp have a window before we activated it?
	set hadWindows to false
	if application "Warp" is running then
		tell application "System Events"
			if exists (process "Warp") then
				set hadWindows to ((count of windows of process "Warp") > 0)
			end if
		end tell
	end if

	tell application "Warp" to activate

	tell application "System Events"
		repeat 30 times
			if frontmost of process "Warp" then exit repeat
			delay 0.1
		end repeat

		tell process "Warp"
			if hadWindows then
				keystroke "t" using command down
				delay 0.35
			else
				repeat 50 times
					if (count of windows) > 0 then exit repeat
					delay 0.1
				end repeat
				delay 0.35
			end if

			keystroke ccCommand
			key code 36 -- Return
		end tell
	end tell
end run
