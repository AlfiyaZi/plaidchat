(function () {
	'use strict';
	// Load in our dependencies
	var gui = window.require('nw.gui');
	var clipboard = gui.Clipboard.get();

	var GOOGLE_SEARCH_URL = 'https://www.google.com/#q=';

	function isSelected(target) {
		return target.selectionStart !== target.selectionEnd;
	}

	function getSelectedValue(target) {
		return target.value.slice(target.selectionStart, target.selectionEnd);
	}

	function removeSelectedValue(target) {
		var selectionStart = target.selectionStart;
		var selectedValue = target.value.slice(target.selectionStart, target.selectionEnd);
		target.value = target.value.slice(0, target.selectionStart) + target.value.slice(target.selectionEnd);
		target.setSelectionRange(selectionStart, selectionStart); // place cursor at original selectionStart
		return selectedValue;
	}

	function pasteValue(target, value) {
		var selectionStart = target.selectionStart + value.length;
		target.value = target.value.slice(0, target.selectionStart) + value + target.value.slice(target.selectionEnd);
		target.setSelectionRange(selectionStart, selectionStart); // place cursor at original selectionStart
	}

	function buildSearchMenuItem(value) {
		var labelValue = value;
		if (labelValue.length > 10) {
			labelValue = labelValue.slice(0, 10) + '...';
		}
		return new gui.MenuItem({
			label: 'Search Google for "' + labelValue + '"',
			click: function () {
				// Example with value of "leaf on the wind":
				// https://www.google.com/#q=leaf%20on%20the%20wind
				gui.Shell.openExternal(GOOGLE_SEARCH_URL + encodeURIComponent(value));
			}
		});
	}

	function buildCopyMenuItem(value, enabled) {
		return new gui.MenuItem({
			label: 'Copy',
			enabled: enabled,
			click: function () {
				clipboard.set(value);
			}
		});
	}

	function buildTextareaMenu(menu, params) {
		var target = params.target;
		var selected = isSelected(target);

		// Select all
		menu.append(new gui.MenuItem({
			label: 'Select All',
			click: function () {
				target.select();
			}
		}));
		// Cut
		menu.append(new gui.MenuItem({
			label: 'Cut',
			enabled: selected,
			click: function () {
				clipboard.set(removeSelectedValue(target));
			}
		}));
		// Copy
		menu.append(buildCopyMenuItem(getSelectedValue(target), selected));

		// Paste
		menu.append(new gui.MenuItem({
			label: 'Paste',
			enabled: clipboard.get() !== undefined && clipboard.get().trim() !== '',
			click: function () {
				pasteValue(target, clipboard.get());
			}
		}));
		// Delete
		menu.append(new gui.MenuItem({
			label: 'Delete',
			enabled: selected,
			click: function () {
				removeSelectedValue(target);
			}
		}));
		// Search Google
		if (selected) {
			var selectedValue = getSelectedValue(target);
			menu.append(buildSearchMenuItem(selectedValue));
		}
	}

	function buildImageMenu(menu, params) {
		var target = params.target;
		menu.append(new gui.MenuItem({
			label: 'Open Image in Browser',
			click: function () {
				if (target.attributes.src) {
					gui.Shell.openExternal(target.attributes.src.value);
				}
			}
		}));
	}

	function buildLinkMenu(menu, params) {
		var target = params.target;
		var teamUrl = params.teamUrl;

		if (target.attributes.href && target.attributes.href.value) {
			var hrefValue = target.attributes.href.value;

			// Relative URL, let's prepend the team URL.
			// For example, `/archives` would become `https://team.slack.com/archives`
			if (hrefValue.startsWith('/') && !hrefValue.startsWith('//')) {
				hrefValue = teamUrl.slice(0, -1) + hrefValue;
			}

			menu.append(new gui.MenuItem({
				label: 'Copy Link',
				click: function () {
					clipboard.set(hrefValue);
				}
			}));

			menu.append(new gui.MenuItem({
				label: 'Open Link',
				click: function () {
					gui.Shell.openExternal(hrefValue);
				}
			}));
		}
	}

	function buildGenericMenu(menu, params) {
		var selection = params.window.getSelection();
		var selected = selection && selection.toString() && selection.toString().trim().length > 0;

		if (selected) {
			var selectedValue = selection.toString();

			// Copy
			menu.append(buildCopyMenuItem(selectedValue, true));

			// Search Google
			menu.append(buildSearchMenuItem(selectedValue));
		}
	}

	module.exports = {
		handleRightClick: function (params) {
			var target = params.target;

			if (target && target.nodeName) {
				var menu = new gui.Menu();

				switch (target.nodeName.toUpperCase()) {
					case 'TEXTAREA': {
						buildTextareaMenu(menu, params);
						break;
					}
					case 'IMG': {
						buildImageMenu(menu, params);
						break;
					}
					case 'A': {
						buildLinkMenu(menu, params);
						break;
					}
					default: {
						buildGenericMenu(menu, params);
						break;
					}
				}

				if (menu.items.length > 0) {
					menu.popup(params.x, params.y);
				}
			}
		}
	};
}());
