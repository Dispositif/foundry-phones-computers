# End-to-end tests (Foundry v14)

Three browsers at once (GM, Alice, Bob) on a throwaway test world, rebuilt at each run.

First time, from the module folder:

    npm install
    npx playwright install chromium

Run:

    npm run test:e2e

The tests start Foundry from `../Foundry-node/app/FoundryVTT-Node-14.370` with the data folder `../Foundry-node/data-v14`
(port 30014), unless a server already answers there. The first launch of that install needs the
license key and the EULA once, in a normal browser at http://localhost:30014.

Overrides: `FOUNDRY_MAIN`, `FOUNDRY_DATA`, `FOUNDRY_PORT`. `KEEP_FOUNDRY=1` leaves the server running.
