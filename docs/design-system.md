# Design system

The interface uses checked-in tokens in frontend/src/app/tokens.css and shared styles in frontend/src/app/globals.css. The workspace shell uses monochrome glass surfaces, locally bundled fonts, light/dark colors, fixed spacing and radii, and one primary action cue. The Word add-in imports the same core tokens.

Fonts are bundled with their licence notices. No browser font service is used. Headless layout checks write private artifacts under .data/verification. Document rendering and editor rules remain part of the interface.
