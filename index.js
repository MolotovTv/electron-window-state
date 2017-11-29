'use strict';

var path = require('path');
var electron = require('electron');
var jsonfile = require('jsonfile');
var mkdirp = require('mkdirp');
var deepEqual = require('deep-equal');

module.exports = function (options) {
  var app = electron.app || electron.remote.app;
  var screen = electron.screen || electron.remote.screen;
  var state;
  var winRef;
  var stateChangeTimer;
  var eventHandlingDelay = 100;
  var config = Object.assign({
    file: 'window-state.json',
    path: app.getPath('userData'),
    maximize: true,
    fullScreen: true
  }, options);
  var fullStoreFileName = path.join(config.path, config.file);

  function isNormal(win) {
    return !win.isMaximized() && !win.isMinimized() && !win.isFullScreen();
  }

  function hasBounds() {
    return state &&
      Number.isInteger(state.x) &&
      Number.isInteger(state.y) &&
      Number.isInteger(state.width) && state.width > 0 &&
      Number.isInteger(state.height) && state.height > 0;
  }

  function getValidWindowBounds(currentState, screenBounds) {
    var newState = Object.assign({}, currentState)

    // Fix window position
    if (
      currentState.x < screenBounds.x ||
      currentState.x > screenBounds.x + screenBounds.width
    ) {
      newState.x = screenBounds.x
    }

    if (
      currentState.y < screenBounds.y ||
      currentState.y > screenBounds.y + screenBounds.height
    ) {
      newState.y = screenBounds.y
    }

    // Fix window dimensions
    if (currentState.width > screenBounds.width) {
      newState.width = screenBounds.width
    }

    if (currentState.height > screenBounds.height) {
      newState.height = screenBounds.height
    }

    // if window position was fixed and window size is smaller than screen size,
    // update window postion again to center it in screen
    if (
      (
        currentState.x !== newState.x ||
        currentState.y !== newState.y
      ) &&
      (
        newState.width < screenBounds.width ||
        newState.height < screenBounds.height
      )
    ) {
      newState.x = newState.x + (screenBounds.width - newState.width) / 2
      newState.y = newState.y + (screenBounds.height - newState.height) / 2
    }

    return newState
  }

  function validateState() {
    var isValid = state && (hasBounds() || state.isMaximized || state.isFullScreen);
    if (!isValid) {
      state = null;
      return;
    }

    if (hasBounds() && state.displayBounds) {
      // Check if the display where the window was last open is still available
      var displayBounds = screen.getDisplayMatching(state).bounds;
      state = getValidWindowBounds(state, displayBounds);
    }
  }

  function updateState(win) {
    win = win || winRef;
    if (!win) {
      return;
    }
    // don't throw an error when window was closed
    try {
      var winBounds = win.getBounds();
      if (isNormal(win)) {
        state.x = winBounds.x;
        state.y = winBounds.y;
        state.width = winBounds.width;
        state.height = winBounds.height;
      }
      state.isMaximized = win.isMaximized();
      state.isFullScreen = win.isFullScreen();
      state.displayBounds = screen.getDisplayMatching(winBounds).bounds;
    } catch (err) {}
  }

  function saveState(win) {
    // Update window state only if it was provided
    if (win) {
      updateState(win);
    }

    // Save state
    try {
      mkdirp.sync(path.dirname(fullStoreFileName));
      jsonfile.writeFileSync(fullStoreFileName, state);
    } catch (err) {
      // Don't care
    }
  }

  function stateChangeHandler() {
    // Handles both 'resize' and 'move'
    clearTimeout(stateChangeTimer);
    stateChangeTimer = setTimeout(updateState, eventHandlingDelay);
  }

  function closeHandler() {
    updateState();
  }

  function closedHandler() {
    // Unregister listeners and save state
    unmanage();
    saveState();
  }

  function fixPosition(win) {
    // Mitigate positionning issues on windows: https://github.com/electron/electron/issues/10862
    win.setPosition(state.x, state.y);
  }

  function manage(win) {
    if (config.maximize && state.isMaximized) {
      win.maximize();
    }
    if (config.fullScreen && state.isFullScreen) {
      win.setFullScreen(true);
    }

    fixPosition(win);

    win.on('resize', stateChangeHandler);
    win.on('move', stateChangeHandler);
    win.on('close', closeHandler);
    win.on('closed', closedHandler);
    winRef = win;
  }

  function unmanage() {
    if (winRef) {
      winRef.removeListener('resize', stateChangeHandler);
      winRef.removeListener('move', stateChangeHandler);
      clearTimeout(stateChangeTimer);
      winRef.removeListener('close', closeHandler);
      winRef.removeListener('closed', closedHandler);
      winRef = null;
    }
  }

  // Load previous state
  try {
    state = jsonfile.readFileSync(fullStoreFileName);
  } catch (err) {
    // Don't care
  }

  // Check state validity
  validateState();

  // Set state fallback values
  state = Object.assign({
    width: config.defaultWidth || 800,
    height: config.defaultHeight || 600
  }, state);

  return {
    get x() { return state.x; },
    get y() { return state.y; },
    get width() { return state.width; },
    get height() { return state.height; },
    get isMaximized() { return state.isMaximized; },
    get isFullScreen() { return state.isFullScreen; },
    saveState: saveState,
    unmanage: unmanage,
    manage: manage
  };
};
