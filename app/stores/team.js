(function () {
	'use strict';
	// Load in our dependencies
	var EventEmitter = require('events').EventEmitter;
	var path = require('path');
	var _ = require('underscore');
	var assign = require('object-assign');
	var AppDispatcher = require('../dispatchers/app');
	var ActionTypes = AppDispatcher.ActionTypes;

	// Define constants
	var CHANGE_EVENT = 'change';
	// DEV: We use `path.join` to eliminate `../../` for `===` comparisons later on
	var SLACK_LOGIN_URL = process.env.NODE_ENV !== 'test' ? 'https://slack.com/signin' :
		'file://' + path.join(__dirname, '../../test/integration-tests/test-server/signin.html');

	// Define our internal storage system
	var _state;
	function _reset() {
		_state = {
			activeTeamId: null,
			_indexCounter: 0,
			_placeholderCounter: 0,
			// This is a mapping from (placeholder value OR team id) -> index to use in `teams` array
			// DEV: When we load our application, we don't know the first team's id yet
			//   As a result, we need to store the index we used for it
			//   and re-use that as the key when we do resolve the id
			//   This keeps ordering consistent and prevents jitter-y refreshes
			teamIndicies: {},
			// Information accessible by all teams
			teamsById: {},
			teamIconsById: {}
		};
	}
	_reset();

	// Define our TeamStore
	var TeamStore = assign({}, EventEmitter.prototype, {
		// Define common bindings for events
		addChangeListener: function (cb) {
			this.on(CHANGE_EVENT, cb);
		},
		emitChange: function () {
			this.emit(CHANGE_EVENT);
		},
		removeChangeListener: function (cb) {
			this.off(CHANGE_EVENT, cb);
		},

		// Define counter to manage team indicies
		getCurrentCounter: function () {
			return _state._indexCounter;
		},
		getCounterAndAdvance: function () {
			return _state._indexCounter++;
		},

		// Define handlers for managing teams
		addPlaceholderTeam: function (url) {
			var placeholderTeam = {
				is_placeholder: true,
				team_id: '_plaidchat-placeholder-' + _state._placeholderCounter,
				team_name: 'Placeholder team ' + _state._placeholderCounter,
				team_url: url || SLACK_LOGIN_URL
			};
			return this.addTeam(placeholderTeam);
		},
		addTeam: function (team) {
			// Prevent mutation of source info
			var copiedTeam = _.clone(team);
			_state.teamsById[copiedTeam.team_id] = copiedTeam;
			// DEV: An index key could be set via `aliasTeamIndex` when we convert from placeholder team to actual team
			if (_state.teamIndicies[copiedTeam.team_id] === undefined) {
				_state.teamIndicies[copiedTeam.team_id] = this.getCounterAndAdvance();
			}

			// If the team has an icon, update it
			if (team.team_icon) {
				_state.teamIconsById[copiedTeam.team_id] = _.clone(team.team_icon);
			}

			// If there's no active team, set this team to it
			if (_state.activeTeamId === null) {
				this.setActiveTeamId(team.team_id);
			}

			// Return our team
			return team;
		},
		aliasTeamIndex: function (srcKey, targetKey) {
			if (_state.teamIndicies[targetKey] === undefined) {
				_state.teamIndicies[targetKey] = _state.teamIndicies[srcKey];
			}
		},
		getActiveTeamId: function () {
			return _state.activeTeamId;
		},
		getTeamIcons: function () {
			return _.clone(_state.teamIconsById);
		},
		getTeamIndicies: function () {
			return _.clone(_state.teamIndicies);
		},
		getTeams: function () {
			// Resolve all our teams
			var teams = _.values(_state.teamsById);

			// and sort them by team index
			teams.sort(function sortByIndex (a, b) {
				var aIndex = _state.teamIndicies[a.id];
				var bIndex = _state.teamIndicies[b.id];
				return bIndex - aIndex;
			});
			return teams;
		},
		getTeamById: function (id) {
			// Lookup and return our team by its id
			return _state.teamsById[id];
		},
		getTeamByUserId: function (userId) {
			// DEV: This isn't performant as we loop over rather than doing an index lookup
			//   Maybe we should use a dictionary for tracking user ids as well?
			var teams = _.values(_state.teamsById);
			var team = _.findWhere(teams, {id: userId});
			return team || null;
		},
		getTeamsById: function () {
			return _state.teamsById;
		},
		// Upon initialization, load last active domain (or default to login URL)
		init: function (url) {
			this.addPlaceholderTeam(url);
		},
		reset: _reset,
		setActiveTeamId: function (id) {
			// If the team id has changed
			var oldTeamId = _state.activeTeamId;
			if (oldTeamId !== id) {
				// Update the active team id
				_state.activeTeamId = id;

				// If the last team was a placeholder, remove it
				if (oldTeamId && this.getTeamById(oldTeamId).is_placeholder) {
					this.removeTeamById(oldTeamId);
				}
			}
		},
		setActiveTeamByUserId: function (id) {
			var team = this.getTeamByUserId(id);
			return this.setActiveTeamId(team.team_id);
		},
		setTeamIcon: function (id, teamIcon) {
			_state.teamIconsById[id] = _.clone(teamIcon);
		},
		updateTeamById: function (id, team) {
			// Mutate existing copied team
			_.extend(this.getTeamById(id), team);
		},
		removeTeamById: function (id) {
			// Remove the team from our stores
			delete _state.teamsById[id];
			delete _state.teamIndicies[id];

			// If they were the active team, then unset the active team
			if (_state.activeTeamId === id) {
				_state.activeTeamId = null;
			}
		}
	});

	// Method to update all of our active teams
	function handleTeamUpdate(action) {
		// If there was a bundled alias request, attach it
		if (action.alias) {
			TeamStore.aliasTeamIndex(action.alias.srcTeamId, action.alias.targetTeamId);
		}

		// If there is a team icon, save it
		if (action.teamIcon) {
			TeamStore.setTeamIcon(action.teamIcon.teamId, action.teamIcon.teamIcon);
		}

		// Collect all of the ids in allTeams
		// [{id: user_id, name: user_name, team_id, team_name, team_url,
		//   team_icon: {image_34: http://url/34.png, image_{44,68,88,102,132}, image_default: true}}]
		// DEV: There is more team info via `getMainTeam`
		var allTeams = action.allTeams;
		var newTeamIds = _.pluck(allTeams, 'team_id');

		// For each of the registered teams, if they aren't in the new teams, then remove them
		// DEV: If there was a placeholder team here, then they will be removed
		var registeredTeams = TeamStore.getTeams();
		registeredTeams.forEach(function deleteRemovedTeam (registeredTeam) {
			if (newTeamIds.indexOf(registeredTeam.team_id) === -1) {
				TeamStore.removeTeamById(registeredTeam.team_id);
			}
		});

		// For each of the teams
		allTeams.forEach(function iterateAllTeams (team) {
			// If the team is new, add it
			if (!TeamStore.getTeamById(team.team_id)) {
				TeamStore.addTeam(team);
			// Otherwise, update it (for good measure, e.g. URL changes, icon changes)
			} else {
				TeamStore.updateTeamById(team.team_id, team);
			}
		});

		// If there no longer is an active team, choose the first one in our list
		if (TeamStore.getActiveTeamId() === null) {
			TeamStore.setActiveTeamId(TeamStore.getTeams()[0].team_id);
		}

		// Trigger a state update
		TeamStore.emitChange();
	}

	// Define our handler for various updates
	TeamStore.dispatchToken = AppDispatcher.register(function handleAction (action) {
		if (action.type === ActionTypes.ACTIVATE_TEAM) {
			console.debug('Setting active team', {teamId: action.teamId, userId: action.userId});
			if (action.teamId !== undefined) {
				TeamStore.setActiveTeamId(action.teamId);
			} else {
				TeamStore.setActiveTeamByUserId(action.userId);
			}
			TeamStore.emitChange();
		} else if (action.type === ActionTypes.ADD_TEAM_REQUESTED) {
			console.debug('Adding placeholder team');
			var placeholderTeam = TeamStore.addPlaceholderTeam();
			TeamStore.setActiveTeamId(placeholderTeam.team_id);
			TeamStore.emitChange();
		} else if (action.type === ActionTypes.APPLICATION_INIT) {
			console.debug('Initializing application', {initialUrl: action.url});
			TeamStore.init(action.url);
			TeamStore.emitChange();
		} else if (action.type === ActionTypes.TEAMS_UPDATE) {
			console.debug('Updating teams', action);
			handleTeamUpdate(action);
		}
	});

	// Expose the login URL as a class property
	TeamStore.SLACK_LOGIN_URL = SLACK_LOGIN_URL;

	// Export our TeamStore
	module.exports = TeamStore;
})();
