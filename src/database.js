/*
  State DB
  ---

  This stores state data, communities data, etc in a database.
*/

const Sequelize = require('sequelize');
const fs = require('fs');

const dbLocation = __dirname + '/../database.db';
let logging = false;

if(process.env.LOG_QUERIES) {
  logging = console.log;
}

const dbHost = process.env.DB_HOST;
const dbUsername = process.env.DB_USER;
const dbPassword = process.env.DB_PASS;
const dbName = process.env.DB_NAME;

let dialect = 'sqlite';
if(dbHost) {
  dialect = 'postgres';
}

if(!fs.existsSync(dbLocation)) {
  const createStream = fs.createWriteStream(dbLocation);
  createStream.end();
}

const sequelize = new Sequelize(dbName, dbUsername, dbPassword, {
  host: dbHost,
  dialect: dialect,

  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  },

  // SQLite only
  storage: dbLocation,

  operatorsAliases: true,

  logging: logging
});

sequelize
  .authenticate()
  .then(() => {
    console.log('DB connection has been established successfully.');
  })
  .catch(err => {
    console.error('Unable to connect to the database:', err);
  });

const Post = sequelize.define('post', {
  community: Sequelize.STRING,
  block: Sequelize.INTEGER,
  fullPermlink: {
    type: Sequelize.TEXT,
    primaryKey: true
  },
  featured: Sequelize.BOOLEAN,
  featurer: Sequelize.STRING,
  pinned: Sequelize.BOOLEAN,
  blocked: Sequelize.BOOLEAN
},{
  indexes:[
    {
      unique: false,
      fields:['block', 'community']
    }
  ]
});

const PinnedPost = sequelize.define('pinnedpost', {
  community: Sequelize.STRING,
  fullPermlink: Sequelize.TEXT
}, {
  indexes: [
  {
    fields: ['community']
  }
]});

const Community = sequelize.define('community', {
  community: {
    type: Sequelize.STRING,
    primaryKey: true
  },
  metadata: Sequelize.TEXT,
  block: Sequelize.INTEGER,
  posts: Sequelize.INTEGER,
  weeklyposts: Sequelize.INTEGER,
  weeklyusers: Sequelize.INTEGER
},{
  indexes:[
    {
      unique: false,
      fields:['block']
    },
    {
      unique: false,
      fields:['posts']
    },
    {
      unique: false,
      fields:['weeklyposts']
    },
    {
      unique: false,
      fields:['weeklyusers']
    }
  ]
});

/*
  We store state in the database by using a single-row table called State for a few reasons:

  * a DB migration will now also migrate the correct current state so the state
  and DB don't have to be migrated seperately.

  * State will no longer need to be stored on persistent disk so the nodes can run on
  hosting services such as Heroku and Google App Engine much more easily.
*/
const State = sequelize.define('state', {
  block: Sequelize.INTEGER,
  state: Sequelize.TEXT,
  lastCheckpointHash: Sequelize.TEXT,
  consensusDisagreements: Sequelize.TEXT
},{
  indexes:[
    {
      unique: false,
      fields:['block']
    }
  ]
});

module.exports = {
  setup: function(genesisState, genesisBlock, callback) {
    sequelize.sync().then(() => {
      State.findOrCreate({
        where: {},
        order: [['block', 'DESC']], // Just in case there are multiple state entries, then we just get the latest one.
        limit: 1,
        defaults: {
          state: JSON.stringify(genesisState),
          block: JSON.stringify(genesisBlock),
          lastCheckpointHash: '',
          consensusDisagreements: '{}'
        }
      }).then(function(result) {
        const entry = result[0];
        const created = result[1];

        if (created) {
          console.log('No state entry found, starting with genesis block and state.');
        }

        callback(entry.dataValues);
      });
    });
  },

  saveState: function(currentBlock, lastCheckpointHash, currentState, consensusDisagreements) {
    State.findOne({
       where: {}
    }).then((result) =>  {
      if (result) {
        result.update({
          block: currentBlock,
          lastCheckpointHash: lastCheckpointHash,
          state: JSON.stringify(currentState),
          consensusDisagreements: JSON.stringify(consensusDisagreements)
        }).then(() => {
          console.log('Saved state.')
        });
      } else {
        console.log('Error saving state: state not correctly created in DB?')
      }
    });
  },

  post: function(community, block, author, permlink) {
    Post.findOrCreate({
      where: {
        fullPermlink: author + '/' + permlink
      },
      defaults: {
        community: community,
        block: block,
        fullPermlink: author + '/' + permlink,
        featured: false,
        featurer: '',
        pinned: false,
        blocked: false
      }
    }).then((result) => {
      if(result[1]) {
        Community.findOne({ where: { community: community } }).then((rows) => {
          Community.update({posts: rows.dataValues.posts+1}, {
            where: {
              community: community
            }
          });
        });
      }
    });
  },

  feature: function(community, author, featurer, permlink) {
    Post.update({
      featured: true,
      featurer: featurer
    }, {
      where: {
        fullPermlink: author + '/' + permlink,
        community: community
      }
    });
  },

  unfeature: function(community, author, featurer, permlink) {
    Post.update({
      featured: false,
      featurer: ''
    }, {
      where: {
        fullPermlink: author + '/' + permlink,
        community: community
      }
    });
  },

  pin: function(community, author, permlink) {
    Post.update({
      pinned: true
    }, {
      where: {
        fullPermlink: author + '/' + permlink,
        community: community
      }
    });

    PinnedPost.create({
      community: community,
      fullPermlink: author + '/' + permlink
    });
  },

  unpin: function(community, author, permlink) {
    Post.update({
      pinned: false
    }, {
      where: {
        fullPermlink: author + '/' + permlink,
        community: community
      }
    });

    PinnedPost.delete({
      where: {
        community: community,
        fullPermlink: author + '/' + permlink
      }
    });
  },

  getNew: function(community, limit, offset, callback) {
    Post.findAll({
      where: {
        community: community,
        pinned: false,
        blocked: false
      },
      order: sequelize.literal('block DESC'),
      limit: limit,
      offset: offset
    }).then(callback);
  },

  getFeatured: function(community, limit, offset, callback) {
    Post.findAll({
      where: {
        community: community,
        featured: true,
        pinned: false,
        blocked: false
      },
      order: sequelize.literal('block DESC'),
      limit: limit,
      offset: offset
    }).then(callback);
  },

  getPinned: function(community, limit, offset, callback) {
    // Workaround found here: https://stackoverflow.com/questions/36164694/sequelize-subquery-in-where-clause
    const tempSQL = sequelize.dialect.QueryGenerator.selectQuery('pinnedposts',{
      attributes: ['fullPermlink'],
      where: {
        community: community
      },
      limit: limit,
      offset: offset
    }).slice(0,-1); // to remove the ';' from the end of the SQL

    Post.findAll( {
      where: {
        fullPermlink: {
          $in: sequelize.literal('(' + tempSQL + ')'),
        }
      }
    }).then(callback);
  },

  block: function(community, author, permlink) {
    Post.update({
      blocked: true
    }, {
      where: {
        fullPermlink: author + '/' + permlink,
        community: community
      }
    });
  },

  unblock: function(community, author, permlink) {
    Post.update({
      blocked: false
    }, {
      where: {
        fullPermlink: author + '/' + permlink,
        community: community
      }
    });
  },

  create: function(community,block) {
    Community.destroy({
      where: {
        community: community
      }
    }).then(() => {
      Community.create({
        community: community,
        metadata: '{}',
        block: block,
        posts: 0,
        weeklyposts: 0,
        weeklyusers: 0
      });
    });
  },

  updateMeta: function(community, metadata) {
    Community.update({
      metadata: metadata
    }, {
      where: {
        community: community
      }
    });
  },

  getData: function(community, callback) {
    Community.findOne({
      where: {
        community: community
      }
    }).then(callback);
  },

  getCommunityOfPost: function(author, permlink, callback) {
    Post.findOne({
      where: {
        fullPermlink: author + '/' + permlink
      }
    }).then(callback);
  },

  getCommunities: function(filter, limit, offset, sort, search, state, callback) {
    function returnRows(rows) {

      const returnValue = rows;
      for(i in rows) {
        try {
          returnValue[i].dataValues.roles = state.communities[rows[i].community].roles;
        } catch(err) {
        }
      }
      callback(returnValue);
    }

    if(filter === 'date') {
      Community.findAll({
        order: [['block', sort]],
        limit: limit,
        offset: offset
      }).then(returnRows);
    } else if(filter === 'weeklyposts') {
      Community.findAll({
        order: [['weeklyposts', sort]],
        limit: limit,
        offset: offset
      }).then(returnRows);
    } else if(filter === 'weeklyusers') {
      Community.findAll({
        order: [['weeklyusers', sort]],
        limit: limit,
        offset: offset
      }).then(returnRows);
    } else if(filter === 'name') {
      Community.findAll({
        order: [['weeklyposts', sort]],
        where: {
          community: {
            [Sequelize.Op.like]: '%' + search + '%'
          }
        },
        limit: limit,
        offset: offset
      }).then(returnRows);
    } else {
      Community.findAll({
        order: [['posts', sort]],
        limit: limit,
        offset: offset
      }).then(returnRows);
    }
  },

  updateWeeklyPosts: function(block, getState) {
    Post.findAll({
      attributes: ['community'],
      where: {
        block: {[Sequelize.Op.gt]: block-201600},
        blocked: false
      }
    }).then((rows) => {
      const state = getState();

      const communityWeeklyPosts = {};
      for(community in state.communities) {
        communityWeeklyPosts[community] = 0;
      }

      for(i in rows) {
        communityWeeklyPosts[rows[i].dataValues.community]++;
      }

      for(community in communityWeeklyPosts) {
        Community.update({ weeklyposts: communityWeeklyPosts[community]}, {
          where: {
            community: community
          }
        });
      }
      console.log('Updated weekly posts.')
    });
  },

  updateWeeklyUsers: function(block, getState) {
    Post.findAll({
      attributes: ['community', 'fullPermlink'],
      where: {
        block: {[Sequelize.Op.gt]: block-201600},
        blocked: false
      }
    }).then((rows) => {
      const state = getState();

      const communityWeeklyUsers = {};
      for(community in state.communities) {
        communityWeeklyUsers[community] = new Set();
      }

      for(i in rows) {
        communityWeeklyUsers[rows[i].dataValues.community].add(rows[i].dataValues.fullPermlink.split('/')[0]);
      }

      for(community in communityWeeklyUsers) {
        Community.update({ weeklyusers: communityWeeklyUsers[community].size}, {
          where: {
            community: community
          }
        });
      }
      console.log('Updated weekly users.')
    });
  }
}
