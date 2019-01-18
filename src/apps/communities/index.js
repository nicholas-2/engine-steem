const matcher = require('match-schema');
const schemas = require('./schemas');

function canEditRole(state, user, community, role) { // Roles 'owner', 'admin', 'moderator', 'author'
  try {
    const roles = state.communities[community].roles

    if(roles.owner.indexOf(user) !== -1 || roles.owner.indexOf('eo') !== -1) {  // @eo means everyone.
      return true;
    } else if(roles.admin.indexOf(user) !== -1 || roles.admin.indexOf('eo') !== -1) {
      if(role === 'owner') {
        return false;
      } else {
        return true;
      }
    } else if(roles.mod.indexOf(user) !== -1 || roles.mod.indexOf('eo') !== -1) {
      if(role === 'mod' || role === 'author') {
        return true;
      } else {
        return false;
      }
    } else if(roles.author.indexOf(user) !== -1){
      return false;
    }
  } catch(err) {
    return false;
  }
}

function canPost(state, user, community) {
  for(i in ['owner', 'admin', 'mod', 'author']) {
    const role = ['owner', 'admin', 'mod', 'author'][i];
    const roles = state.communities[community].roles;
    if(roles[role].indexOf(user) !== -1) {
      return true;
    }
  }
}

function app(processor, getState, setState, prefix) {
  processor.on('cmmts_create', function(json, from) {
    var state = getState()
    const {matched, errorKey} = matcher.match(json, schemas.createCommunity);
    if(matched && state.communities[json.id] === undefined) {
      state.communities[json.id] = {
        roles: {
          owner: [
            from
          ],
          admin: [],
          mod: [],
          author: []
        },
        posts: {

        }
      }

      console.log(from, 'created community', json.id);
    } else {
      console.log('Invalid community creation from', from)
    }
    setState(state)
  });

  processor.on('cmmts_grant_role', function(json, from) {
    var state = getState();
    const {matched, errorKey} = matcher.match(json, schemas.grantRole);
    if(matched && state.communities[json.community] !== undefined && (json.role === 'owner' || json.role === 'mod' || json.role === 'admin' || json.role === 'author') && state.communities[json.community].roles[json.role].indexOf(json.receiver) === -1) {
      // Check authorization
      if(canEditRole(state, from, json.community, json.role)) {
        console.log(from, 'granted role', json.role, 'to', json.receiver);
        state.communities[json.community].roles[json.role].push(json.receiver)
      } else {
        console.log(from, 'tried to grant role but lacked proper permissions.')
      }
    } else {
      console.log('Invalid role grant from', from)
    }

    setState(state);
  });

  processor.on('cmmts_remove_role', function(json, from) {
    var state = getState();
    const {matched, errorKey} = matcher.match(json, schemas.removeRole);
    if(matched && state.communities[json.community] !== undefined && (json.role === 'owner' || json.role === 'mod' || json.role === 'admin' || json.role === 'author') && state.communities[json.community].roles[json.role].indexOf(json.receiver) > -1) {
      // Check authorization
      if(canEditRole(state, from, json.community, json.role)) {
        console.log(from, 'removed role', json.role, 'from', json.receiver);
        const roleIndex = state.communities[json.community].roles[json.role].indexOf(json.receiver);
        state.communities[json.community].roles[json.role].splice(roleIndex, 1);
      } else {
        console.log(from, 'tried to remove role but lacked proper permissions.')
      }
    } else {
      console.log('Invalid role removal from', from)
    }

    setState(state);
  });

  processor.onOperation('comment', function(json) {
    var state = getState();
    if(json.parent_author === '' && json.json_metadata) {
      let meta = {}
      try {
        meta = JSON.parse(json.json_metadata);
      } catch(err) {
        meta = {}
      }
      const community = meta[prefix+'cmmts_post']

      if(community) {
        if(state.communities[community] && canPost(state, json.author, community)) {
          console.log('post')
          // Actual post behaviour here
        }
      }
    }
    setState(state);
  });

  return processor;
}

function cli(input, getState) {
  input.on('communities_create', function(args, transactor, username, key) {
    const id = args[0];

    transactor.json(username, key, 'cmmts_create', {
      id: id
    }, function(err, result) {
      if(err) {
        console.error(err);
      }
    });
  });

  input.on('communities_grant_role', function(args, transactor, username, key) {
    const role = args[0];
    const receiver = args[1];
    const community = args[2];

    transactor.json(username, key, 'cmmts_grant_role', {
      community: community,
      receiver: receiver,
      role: role
    }, function(err, result) {
      if(err) {
        console.error(err);
      }
    });
  });

  input.on('communities_remove_role', function(args, transactor, username, key) {
    const role = args[0];
    const receiver = args[1];
    const community = args[2];

    transactor.json(username, key, 'cmmts_remove_role', {
      community: community,
      receiver: receiver,
      role: role
    }, function(err, result) {
      if(err) {
        console.error(err);
      }
    });
  });

  input.on('communities_post', function(args, transactor, username, key, client, dsteem) {

    client.broadcast
      .comment(
        {
            author: username,
            body: 'Test post',
            json_metadata: args.slice(1).join(' '),
            parent_author: '',
            parent_permlink: 'test',
            permlink: 'testing-testing-1-2-3' + args[0],
            title: 'Test title',
        },
        dsteem.PrivateKey.fromString(key)
    )
    .then(
        function(result) {},
        function(error) {
            console.error(error);
        }
    );
  });
}

function api(app, getState) {
  return app;
}

module.exports = {
  app: app,
  cli: cli,
  api: api
}
