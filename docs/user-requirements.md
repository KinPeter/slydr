# Slydr | user requirements

The goal is a locally running browser based application to play customizable slide shows of pictures from folders on the user's computer.

- tech stack: full stack javascript based application - find appropriate framework and tools
- backend: locally running api to read and traverse file system and provide image urls
- frontend: locally running browser ui with 3 main areas/functions: 1. file/folder explorer, 2. slide show configuration, 3. slide show player
- the app must be operating system agnostic, work on windows, linux and mac (file system traversal)
- the slide show should always play all the images in the selected folder
- the ui must be responsive, optimized to work on smaller and bigger screens
- the ui must have dark and light themes using the system settings by default, with a theme switch button on the top-right corner displayed on the file explorer and configuration screens
- save last used theme setting in local storage and apply on next load

## UX 

### Main user flow

1. Select the folder to run the slide show from (file explorer)
2. Adjust slide show configuration
3. Play the slide show

### File explorer screen

- it should start from the user's home folder (os agnostic)
- it should have icons grid and single column list view
- use list view by default
- save last used ui settings in local storage and apply on next load
- always list folders first
- items are sorted by name
- hide hidden files and folders by default with option to show them
- differentiate 3 types of items: folder, image, any other file
- have an icon for folders, images and any other files
- in list view use these 3 icons by type
- in grid view use thumbnails for images, icons for folders and other files
- double click to open folders
- final action button: "select this folder" -> use the folder for slide show where the user is inside at the moment

### Slide show configuration screen

- display the selected folder name
- option to go back to the file 
- save configuration options in local storage and apply on next load
- final action button: "play slide show"

#### Configuration options for slide show:

- slider: duration for image shown in seconds, range: 1 to 30, default to 5
- checkbox: shuffle images - playing them in random order - on by default
- checkbox: loop slide show - start again when all images were shown - on by default
- checkbox: use animations and transitions - on by default
- checkbox: fill empty space on screen - on by default
- checkbox: start in full screen - on by default

### Slide show player

- plays slide show from the images in the selected folder according to the configuration
- non-disturbing controls overlay at the bottom center of the screen, hides after 2 sec, show on mouse movement
- controls overlay buttons: toggle full screen, previous image, next image, pause/play, stop/exit
- pausing halts the slide show and keeps the current image on the screen
- stopping/exiting the slide show goes back to the configuration screen
- depending on the full screen config use full screen mode or fill window (100vh*100vw)
- images are always scaled to fill the screen with proportions kept
- if the "fill empty space" config is off, use black backround on dark mode, white on light theme
- if the "fill empty space" config is on, use an enlarged, darkened and blurred version of the displayed image as a background - similar to the windows 11 default photos app slideshow does
- blurred, darkened background must always fill the full available screen (empty areas around the image)
- if the "use animations and transitions" config is off, simply display the images centered, fitted to the screen, static, change to next one without transition
- if the "use animations and transitions" config is on, use a minimal animation on each image and transtions between them (see below)
- animation: the image starts at a size fitted to the screen and very slowly and slightly zooming in during the slide duration
- transition: non-disturbing fade-out/fade-in + zoom-in/zoom-out between the images
- slide show player should also react to keyboard shortcuts: space key: play/pause; escape key: stop/exit; left and right arrow keys: previous and next image; "f" key: toggle fullscreen
