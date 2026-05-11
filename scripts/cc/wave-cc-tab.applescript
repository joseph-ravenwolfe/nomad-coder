-- Open a Wave terminal tab in a target directory and run the configured CLI.
--
-- Usage:
--   osascript wave-cc-tab.applescript <target-dir> [<cli-command> [<resume-session-id>]]
--
-- When resume-session-id is provided, runs `<cli> --resume <sid>` instead
-- of the kickstart-prompt fresh-launch — used by the bridge's /cc "Resume"
-- picker.
--
-- Wave (https://www.waveterm.dev/) is an Electron-based terminal. As of this
-- writing it has no AppleScript dictionary, so this script uses System
-- Events keystroke synthesis: activate the app, send Cmd+T to open a new
-- tab, then type the command. This is the same fallback approach used for
-- Ghostty and Warp.
--
-- If Wave changes its new-tab shortcut, set it back to Cmd+T in
-- Settings → Keybindings, or fork this script.

on run argv
	if (count of argv) < 1 then
		error "Usage: osascript wave-cc-tab.applescript <target-dir> [<cli-command> [<resume-session-id>]]"
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

	-- Did Wave have a window before activate?
	set hadWindows to false
	if application "Wave" is running then
		tell application "System Events"
			if exists (process "Wave") then
				set hadWindows to ((count of windows of process "Wave") > 0)
			end if
		end tell
	end if

	tell application "Wave" to activate

	tell application "System Events"
		repeat 30 times
			if frontmost of process "Wave" then exit repeat
			delay 0.1
		end repeat

		tell process "Wave"
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
