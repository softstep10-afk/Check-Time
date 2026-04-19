CHECK-TIME - Getting Started
=============================

This is your new workforce tracking app. It replaces the old HTML file.
Your workers, project (Home), and clock history are already in here.


FIRST TIME SETUP (do this once)
-------------------------------
1. Unzip this folder somewhere on your computer (like Desktop)
2. Double-click SETUP.bat
   - If it says Node.js is not installed, it will open the download page
   - Install Node.js (click the big green LTS button), restart your PC
   - Then run SETUP.bat again
3. Wait for it to finish (1-2 minutes)


RUNNING THE APP
---------------
1. Double-click START.bat
2. Your browser opens to http://localhost:3000
3. Log in with your PIN (same one you've been using)
4. To stop: close the black terminal window


YOUR TEAM
---------
Owner (manager) and Djon (worker) are already set up with their PINs.

To add a new worker:
  - Log in as Owner
  - Go to Team
  - Fill in: Name + PIN (4-6 digits) + Role
  - That's it. Tell the worker their PIN. They log in with it.


IMPORTANT FILES (don't delete these)
-------------------------------------
.env.local     - Your database connection (keys are already set up)
SETUP.bat      - Run once to install
START.bat      - Run every time to start the app
src/           - The app code
supabase/      - Database setup files


NEED HELP?
----------
If something breaks, the CLAUDE.md file in this folder has everything
an AI assistant needs to understand and fix the app. Open Claude Code
or any AI tool and tell it to read CLAUDE.md.
