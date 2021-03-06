const config = require('./config');
const steem = require('steem');

let database = require('mysql').createConnection(config.database);

database.connect((err) => {
    if (err) throw err;
    console.log("Database connection etablished!");
});

database.addMessage = async (id, author, permlink) => {
    return new Promise((resolve, reject) => {
        let sql = "INSERT INTO message (discord_id, author, permlink, posted) VALUES (?,?,?,?)";
        database.query(sql, [id, author, permlink, (new Date()).toISOString().slice(0, 19).replace('T', ' ')], (err, result) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                resolve(true);
            }
        })
    })
};

database.getMessagesToVote = async () => {
    return new Promise((resolve, reject) => {
        let sql = "SELECT * FROM message WHERE voted = 0";
        database.query(sql, (err, result) => {
            if (err) {
                reject(err);
                console.log(err);
            } else {
                resolve(result);
            }
        })
    })
}

database.getMessage = async (author, permlink) => {
    return new Promise((resolve, reject) => {
        let sql = "SELECT * FROM message where author = ? and permlink = ?";
        database.query(sql, [author, permlink], (err, result) => {
            if (err) {
                reject(err);
                console.log(err);
            } else {
                if (result.length != 1)
                    resolve(null)
                else
                    resolve(result[0]);
            }
        })
    })
};

database.getMessages = async () => {
    return new Promise((resolve, reject) => {
        let sql = "SELECT * FROM message";
        database.query(sql, (err, result) => {
            if (err) {
                reject(err);
                console.log(err);
            } else {
                resolve(result);
            }
        })
    })
};

database.existMessage = async (author, permlink) => {
    let message = await database.getMessage(author, permlink);
    return new Promise((resolve, reject) => {
        if (!message) resolve(false);
        else resolve(true)
    })
};

database.updateReactions = async (id, reactions) => {
    return new Promise((resolve, reject) => {
        let sql = "UPDATE message SET ? WHERE voted = 0 and discord_id = " + id;
        database.query(sql, reactions, (err, result) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                resolve(true);
            }
        })
    })
};

function calculateVote(post) {
    if (post.one_hundred >= 3)
        return 10000

    let weight = 0

    // add up all the weights
    for (let i = 0; i < post.game_die; i++)
        weight += 100 * (1 + Math.floor(Math.random() * 6));
    for (let i = 0; i < post.heart; i++)
        weight += 1500;
    for (let i = 0; i < post.up; i++)
        weight += 500;
    for (let i = 0; i < post.down; i++)
        weight -= 500;

    // if there is a disagrement, no vote
    if (weight > 0 && post.down > 0)
        return 0

    return weight
}

function countReaction(message) {
    let reactions = {}
    for (const key in config.discord.curation.curation_emojis)
        reactions[key] =
            message.reactions.get(config.discord.curation.curation_emojis[key]) ?
                message.reactions.get(config.discord.curation.curation_emojis[key]).count
                : 0

    return reactions;
}

module.exports = {
    DTubeLink: (str) => {
        let words = str.split(' ')
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            if (word.startsWith('https://d.tube'))
                return word
        }
        return
    },
    calculateVote,
    countReaction,
    getMinutesSincePost: (posted) => {
        let diff = (new Date()).getTime() - posted.getTime();
        return (diff / 60000);
    },
    vote: async (message, client) => {
        return new Promise((resolve, reject) => {
            client
                .guilds
                .get(config.discord.curation.guild)
                .channels
                .get(config.discord.curation.channel)
                .fetchMessage(message.discord_id).then(post => {
                database.updateReactions(post.id, countReaction(post)).then(async () => {
                    let weight = calculateVote(message);
                    if (weight === 0) {
                        reject('Weight=0')
                    } else {
                        console.log('voting', message.author + '/' + message.permlink, weight)
                        steem.broadcast.vote(
                            config.steem.wif,
                            config.steem.account, // Voter
                            message.author, // Author
                            message.permlink, // Permlink
                            weight,
                            (err, result_bc) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    let sql = "UPDATE message SET voted = 1, vote_weight = ? WHERE author = ? and permlink = ?";
                                    database.query(sql, [weight, message.author, message.permlink], (err, result) => {
                                        console.log("Voted with " + (weight / 100) + "% for @" + message.author + '/' + message.permlink)
                                        resolve(result_bc);
                                    })
                                }
                            }
                        );
                    }


                })
            });

        })
    },
    database
};