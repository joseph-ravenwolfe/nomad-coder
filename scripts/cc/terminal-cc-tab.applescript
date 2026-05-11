-- Open a macOS Terminal.app tab in a target directory and run the configured
-- CLI.
--
-- Usage:
--   osascript terminal-cc-tab.applescript <target-dir> [<cli-command> [<resume-session-id>]]
--
-- When resume-session-id is provided, runs `<cli> --resume <sid>` instead
-- of the kickstart-prompt fresh-launch — used by the bridge's /cc "Resume"
-- picker.
--
-- Uses Terminal.app's native `do script` dictionary entry. With no `in
-- window` clause, `do script` opens a new Terminal window. To get a new
-- TAB in an existing window we synthesize Cmd+T via System Events first
-- (Terminal's dictionary has no `make new tab` verb), then `do script in
-- selected tab of front window` to run the command in that fresh tab.

on run argv
	if (count of argv) < 1 then
		error "Usage: osascript terminal-cc-tab.applescript <target-dir> [<cli-command> [<resume-session-id>]]"
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

	-- Did Terminal have a window before we activated it?
	set hadWindows to false
	if application "Terminal" is running then
		tell application "Terminal"
			set hadWindows to ((count of windows) > 0)
		end tell
	end if

	tell application "Terminal" to activate

	if hadWindows then
		-- New tab in the existing front window: synthesize Cmd+T.
		tell application "System Events"
			repeat 30 times
				if frontmost of process "Terminal" then exit repeat
				delay 0.1
			end repeat
			keystroke "t" using command down
		end tell
		delay 0.3
		tell application "Terminal"
			do script ccCommand in selected tab of front window
		end tell
	else
		-- Cold start: do script with no `in` clause creates a new window.
		tell application "Terminal"
			do script ccCommand
		end tell
	end if
end run
