# Troubleshooting

Symptoms as users and builders report them. The help guide inside the widget carries the user-facing subset of these; keep the two in step.

## In the app

| Symptom | Cause | Fix |
|---|---|---|
| "Connecting to map..." never goes away | No map widget selected in the settings, or the map failed to load | In the builder, open the widget settings and pick the map. Check the map loads on its own. |
| Red banner: Layer "Tickets" not found in map | `ticketsLayerTitle` does not match the feature layer's title in the web map, or the layer is a map image sublayer | Match the title exactly (case matters). The layer must be a feature layer. |
| Has Comments, Has Survey or the comment sorts are missing | The comments or survey table is not in the web map, so `onView` found nothing to match | In Map Viewer add the table (not the layer) from the FeatureServer, save the map, reload the app. The browser console lists "RAC Manager:" lines saying what was found. |
| Comment box says "Comments table not found." | Same as above for the comments table | Same fix. |
| Photos tab is empty although the submitter attached pictures | Attachments are read from the Tickets layer; the signed-in user cannot read attachments, or the layer has attachments disabled | Check the layer's attachment capability and the user's role. |
| Save changes stays disabled | A status change needs a note, or the amber routing warning is showing | Type the note, or fix the department and category so they match. |
| "Resolved date cannot be in the future" or "earlier than the date the ticket was created" | Backdated date outside the allowed range | Pick a date between the ticket's creation day and today. |
| Comment saved, photo did not | Picture over 15 MB, not an image, or the attachment POST failed | Attach a JPG or PNG under 15 MB. Console shows `addAttachment failed` with the server's reply. |
| Export does nothing or errors | ExcelJS is loaded from cdnjs at click time; the network or a content policy blocked it | Allow `cdnjs.cloudflare.com`, or bundle the library. The button shows "Exporting…" first and an error banner after, so a silent failure means the script never ran. |
| Map does not follow the list (points for every ticket) | The layer's `definitionExpression` was cleared by another widget or a refresh | The widget reapplies it on select, back and through a watcher. If another widget also sets the expression, the last writer wins; keep one owner. |
| Hover highlight does nothing | `whenLayerView` failed (console warning "Could not get layerView") | The layer is not in the current view (hidden group, scale range). Highlight is optional; nothing else is affected. |
| Filters or column widths come back after "Clear All" | They are read from `localStorage` on mount, and Clear All saves the cleared state, so this should not happen; a second copy of the widget in another app on the same origin shares the same key | The keys are `rac-manager-filters-v1` and `rac-manager-sidebar-width-v1`, not namespaced by widget id. Clear site data, or namespace the key (see MAINTENANCE.md, add a config key). |
| The first-run hint keeps coming back | Private browsing, or site data blocked: `localStorage` writes throw and are swallowed | Expected in private windows. Otherwise check the browser's storage settings. |
| Help button missing | `showHelp` is `false` in the config | Turn "Help button and guide" on in the settings panel. |
| Colors look wrong in a dark theme | A literal color remains somewhere | Most colors come from the theme tokens; status chip colors, success greens and danger tints are literals on purpose. Report where it looks wrong. |
| Column resize handle cannot be reached with the keyboard | Older build | Since the audit the handle is focusable: Tab to it, left and right arrows resize, Home resets. |

## In the builder or the build

| Symptom | Cause | Fix |
|---|---|---|
| Settings panel is blank | Something under `src/setting/` imports `esri/*`, directly or through a shared module | Remove the import; load SDK modules with `loadArcGISJSAPIModules` at click time if needed. `theme.ts` and `jimu-theme` are fine. |
| Settings panel and runtime fail with "Cannot convert undefined or null to object" after a full rebuild | The widget `tsconfig.json` was switched to classic `jsx: react` | Restore `"jsx": "react-jsx"` and `"jsxImportSource": "@emotion/react"`, delete `dist\widgets\rac-manager`, restart the client. |
| `rac-manager is duplicated` | Two folders register the same manifest name (nested copy, leftover copy, stale `dist\widgets` build) | See the widget README, "Troubleshooting: rac-manager is duplicated". |
| `TS2307 Cannot find module 'calcite-components'` | The master shim does not declare the bare alias | `src/vendor-shims.d.ts` declares it; make sure `tsconfig.json` lists that file first under `files`. |
| Visual Studio reports thousands of errors from `client\jimu-core` | The tsconfig has `paths` or `baseUrl` again (mode A on a pnpm install) | Keep mode B: no `paths`, `"types": []`, both shim files under `files`. |
| `npx tsc -p .` complains about `moduleResolution: Node` | TypeScript 6 deprecation | Add `--ignoreDeprecations 6.0`. |
| `npm test` fails at `require('typescript')` | TypeScript is not installed on the machine or the path | `npm i -g typescript`, or `npm i --no-save typescript` in the widget folder (node_modules is git-ignored). |
| `node --test tests/` says "Cannot find module .../tests" | Node treats a bare directory as a file | Use `npm test` or `node --test tests/*.test.js`; node expands the pattern itself. |
| Webpack "Module not found" for a file that exists | Files landed while `npm start` was watching, and the importer compiled before the new file arrived | Save the importing file once or restart the client. |
