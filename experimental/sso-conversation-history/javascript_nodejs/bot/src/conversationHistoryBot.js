const { ActivityHandler, ActivityTypes } = require('botbuilder');
const { findBestMatch } = require('string-similarity');

const fetchGitHubProfileName = require('./fetchGitHubProfileName');
const fetchMicrosoftGraphProfileName = require('./fetchMicrosoftGraphProfileName');
const historyHelper = require('./utils/historyHelper');
const botConst = require('./botConstants');

class ConversationHistoryBot extends ActivityHandler {
    constructor(userStates) {
        super();

        this.userState = userStates.userState;
        this.authUserState = userStates.authUserState;

        // For simplicity, we are using "string-similarity" package to guess what the user asked.
        function guessQuestion(message) {
            const match = findBestMatch(message, Object.values(botConst.QUESTIONS));

            if (match.bestMatch.rating > .5) {
                return Object.keys(botConst.QUESTIONS)[match.bestMatchIndex];
            }
        }

        this.onMembersAdded(async (context, next) => {
            const membersAdded = context.activity.membersAdded;
            for (let cnt = 0; cnt < membersAdded.length; ++cnt) {
                if (membersAdded[cnt].id !== context.activity.recipient.id) {
                    await context.sendActivity("Hi");
                }
            }
            // By calling next() you ensure that the next BotHandler is run.
            await next();
        });

        // Handler for "event" activity
        this.onEvent(async (context, next) => {
            const { activity: { channelData, name } } = context;

            // When we receive an event activity of "oauth/signin", set the access token to conversation state.
            if (name === 'oauth/signin') {
                const { oauthAccessToken, oauthProvider } = channelData;

                await context.sendActivity({ type: 'typing' });

                switch (oauthProvider) {
                    case 'github':
                        await fetchGitHubProfileName(oauthAccessToken).then(async profile => {
                            await historyHelper.setUserIdAndSendHistory(context, profile, this.userState, 'GitHub');
                        });

                        break;

                    case 'microsoft':
                        await fetchMicrosoftGraphProfileName(oauthAccessToken).then(async profile => {
                            await historyHelper.setUserIdAndSendHistory(context, profile, this.userState, 'Azure AD');
                        });

                        break;
                }
            } else if (name === 'oauth/signout') {
                // If we receive the event activity with no access token inside, this means the user is signing out from the website.
                await context.sendActivity('See you later!');
            } else if (name === 'GetUserHistory') {
                await historyHelper.sendUserHistory(context, this.userState, context.activity.channelData.initialHistory);
            }

            await next();
        });

        // Handler for "message" activity
        this.onMessage(async (context, next) => {
            const { activity: { channelData: { oauthAccessToken } = {}, text } } = context;

            const match = guessQuestion(text);

            if (/^hello\d+$/.test(match)) {
                // When the user say, "hello" or "hi".
                await context.sendActivity({
                    text: 'Hello there. What can I help you with?',
                    ...botConst.SUGGESTED_ACTIONS
                });
            } else if (/^bye\d+$/.test(match)) {
                // When the user say "bye" or "goodbye".
                await context.sendActivity({
                    name: 'oauth/signout',
                    type: 'event'
                });
            } else if (match === 'time') {
                // When the user say "what time is it".
                const now = new Date();

                await context.sendActivity({
                    text: `The time is now ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. What can I do to help?`,
                    ...botConst.SUGGESTED_ACTIONS
                });
            } else if (
                match === 'order'
            ) {
                // When the user says "where are my orders".

                if (oauthAccessToken) {
                    // Tell them they have a package if they are signed in.
                    await context.sendActivity({
                        text: 'There is a package arriving later today.',
                        ...botConst.SUGGESTED_ACTIONS
                    });
                } else {
                    // Send them a sign in card if they are not signed in.
                    await context.sendActivity(botConst.SIGN_IN_MESSAGE);
                }
            } else {

                if (!isNaN(text)) {
                    if (!oauthAccessToken) {
                        // Deep copy, so we can change the .text
                        let signInMessage = JSON.parse(JSON.stringify(botConst.SIGN_IN_MESSAGE));
                        signInMessage.attachments[0].content.text = 'Please sign in to keep a running total.';
                        await context.sendActivity(signInMessage);
                    }
                    else {
                        // If the user sent a number, add it to a running total.
                        const runningTotalProperty = this.authUserState.createProperty("RunningTotal");
                        let total = await runningTotalProperty.get(context, 0);
                        total += Number(text);
                        await runningTotalProperty.set(context, total);

                        await context.sendActivity({
                            text: 'Running total:' + total
                        });
                    }
                } else {
                    // Unknown phrases.
                    await context.sendActivity({
                        text: 'Sorry, I don\'t know what you mean.',
                        ...botConst.SUGGESTED_ACTIONS
                    });
                }
            }

            await next();
        });

        this.onDialog(async (context, next) => {
            // Save any state changes. The load happened during the execution.
            await this.userState.saveChanges(context, false);
            await this.authUserState.saveChanges(context, false);

            // By calling next() you ensure that the next BotHandler is run.
            await next();
        });
    }
}

module.exports.ConversationHistoryBot = ConversationHistoryBot;