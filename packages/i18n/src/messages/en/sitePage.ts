import { defineMessages } from "../../message";

/**
 * The public web pages that do one task: join a server, return from Slack or Discord, return from
 * billing, report a hosted site, and the load error page. `apps/auth-api` renders
 * them on the server in the visitor's language.
 */
export const messages = defineMessages("sitePage", {
  "sitePage.error.title": "This page could not load",
  "sitePage.error.body":
    "Check your connection and reload the page. If it still does not load, go back to the home page.",
  "sitePage.error.reload": "Reload page",
  "sitePage.error.home": "Back to home",
  "sitePage.join.title": "Join a Slavebot server",
  "sitePage.join.description": "Open a private server invitation in Slavebot.",
  "sitePage.join.eyebrow": "Private invitation",
  "sitePage.join.intro":
    "Open this invitation in Slavebot. The app checks the server and asks you to confirm before it connects.",
  "sitePage.join.invalid":
    "This invitation link is not valid or is not complete. Ask the server owner for a new invitation.",
  "sitePage.join.open": "Open Slavebot",
  "sitePage.join.browser": "Open in browser",
  // {browser} and {download} are links. Their text is browserLink and downloadLink.
  "sitePage.join.noApp": "No app? {browser} or {download}.",
  "sitePage.join.noAppMobile": "No app? {browser}.",
  "sitePage.join.browserLink": "Join in this browser",
  "sitePage.join.downloadLink": "download Slavebot",
  // {open} is the label of the button that did not open Slavebot.
  "sitePage.join.notOpened":
    "If Slavebot is on this computer, start it, then press {open} again. If it is not, download it first.",
  // {open} is the label of the button above this note.
  "sitePage.join.mobile":
    "If Slavebot is installed, tap {open}. You can also paste this link into Add server in the app.",
  "sitePage.join.email": "If the invitation came by email, sign in to Slavebot with that email address.",
  // {name} is Slack or Discord on all the connect keys.
  "sitePage.connect.title": "Return to Slavebot",
  "sitePage.connect.failedTitle": "The connection did not finish",
  "sitePage.connect.openApp": "Open Slavebot",
  "sitePage.connect.tryAgainApp": "Try again in Slavebot",
  "sitePage.connect.tryAgainBrowser": "Try again in browser",
  "sitePage.connect.doneInWebClient": "Your Slavebot tab finishes the {name} connection. You can close this tab.",
  "sitePage.connect.doneInApp": "Slavebot finishes the {name} connection on your computer.",
  "sitePage.connect.failure.cancelled": "The {name} connection was cancelled. Nothing changed.",
  "sitePage.connect.failure.expired": "The {name} sign-in expired. Start the connection again.",
  "sitePage.connect.failure.exchange": "{name} did not confirm the connection. Try again.",
  "sitePage.connect.failure.enterprise": "Connect one Slack workspace, not a whole organization.",
  "sitePage.connect.failure.takenSlack":
    "Another Slavebot server already answers this Slack workspace. Disconnect it on that server, then try again.",
  "sitePage.connect.failure.takenDiscord":
    "Another Slavebot server already answers this Discord server. Disconnect it on that server, then try again.",
  "sitePage.connect.failure.unavailable": "Slavebot cannot connect to {name} now. Try again later.",
  "sitePage.connect.failure.tabClosed":
    "The Slavebot tab that started the {name} connection did not answer. Open Slavebot in your browser and connect {name} again.",
  "sitePage.connect.failure.failed": "{name} did not finish the connection. Try again.",
  // {marketplace}, {apps} and {connect} are the names of these screens and that button in the app.
  "sitePage.connect.restartHint": "In Slavebot, open {marketplace}, then {apps}, then {name}, and select {connect}.",
  "sitePage.connect.notOpened":
    "Start Slavebot, then try again. If Slavebot is not on this computer, download it and connect {name} from the app.",
  "sitePage.openApp.title": "Nothing opened?",
  "sitePage.openApp.dismiss": "Not now",
  "sitePage.billing.pageTitle": "Slavebot billing",
  "sitePage.billing.updatedTitle": "Billing updated",
  "sitePage.billing.updatedBody": "Go back to Slavebot. You can close this page.",
  "sitePage.billing.cancelledTitle": "Checkout cancelled",
  "sitePage.billing.cancelledBody": "Nothing was charged. Go back to Slavebot.",
  "sitePage.report.pageTitle": "Report a hosted site — Slavebot",
  "sitePage.report.title": "Report a hosted site",
  "sitePage.report.intro": "Send a report about harmful or unlawful content on an openbot.site address.",
  "sitePage.report.hostnameLabel": "Site address",
  "sitePage.report.hostnameMissing": "Enter the site address",
  "sitePage.report.reasonLabel": "Reason",
  "sitePage.report.reason.phishing": "Phishing",
  "sitePage.report.reason.malware": "Malware",
  "sitePage.report.reason.abuse": "Abuse",
  "sitePage.report.reason.copyright": "Copyright",
  "sitePage.report.reason.other": "Other",
  "sitePage.report.detailsLabel": "Details",
  "sitePage.report.optional": "Optional",
  "sitePage.report.detailsPlaceholder": "What is wrong with this site?",
  "sitePage.report.send": "Send report",
  "sitePage.report.sending": "Sending…",
  "sitePage.report.tooMany": "Too many reports. Try again later.",
  "sitePage.report.sendFailed": "Could not send the report. Try again.",
  // {email} is the contact address. The page shows it as a link.
  "sitePage.report.writeTo": "You can also write to {email}.",
  "sitePage.report.sentTitle": "Report sent",
  "sitePage.report.sentBody": "Thanks. We received your report.",
  "sitePage.report.home": "Go to the home page",
  "sitePage.pricing.title": "Slavebot pricing",
  "sitePage.pricing.description":
    "Hosted servers and a license for teams. Slavebot is free for personal use on your own computer.",
  "sitePage.pricing.heading": "Pricing",
  "sitePage.pricing.enterprise.title": "Enterprise",
  // {count} is the largest number of members that the page sells, such as 25.
  "sitePage.pricing.enterprise.body":
    "Larger servers, more than {count} members, or anything else you need. With enterprise support.",
  "sitePage.pricing.enterprise.contact": "Contact sales",
  // The public Marketplace on openbot.run. The tab and category names are the app's `marketplace.*` keys.
  "sitePage.marketplace.agents.title": "Agents — Slavebot Marketplace",
  "sitePage.marketplace.agents.description":
    "Agents that people made in Slavebot. Add one to Slavebot with its skills and routines.",
  "sitePage.marketplace.skills.title": "Skills — Slavebot Marketplace",
  "sitePage.marketplace.skills.description": "Skills that a Slavebot agent can use. Add one to Slavebot.",
  "sitePage.marketplace.apps.title": "Apps — Slavebot Marketplace",
  "sitePage.marketplace.apps.description":
    "Apps and tools that a Slavebot agent can use. Open an app in Slavebot, and decide there what it connects to.",
  // {name} is the name of an agent or a skill.
  "sitePage.marketplace.agentTitle": "{name} — Slavebot agent",
  "sitePage.marketplace.skillTitle": "{name} — Slavebot skill",
  // The text of the share image for screen readers. {creator} is the name of the person who made it.
  "sitePage.marketplace.agentImageAlt": "{name}, a Slavebot agent by {creator}",
  "sitePage.marketplace.skillImageAlt": "{name}, a Slavebot skill by {creator}",
  "sitePage.marketplace.categories": "Categories",
  "sitePage.marketplace.allCategories": "All",
  "sitePage.marketplace.searchAgents": "Search agents",
  "sitePage.marketplace.searchSkills": "Search skills",
  "sitePage.marketplace.searchApps": "Search apps",
  "sitePage.marketplace.featured": "Featured",
  "sitePage.marketplace.results": "Results",
  "sitePage.marketplace.seeAll": "See all",
  "sitePage.marketplace.add": "Add",
  // {name} is the name of the person who made the agent or the skill.
  "sitePage.marketplace.by": "by {name}",
  // A screen reader reads this after the name of a verified agent or skill.
  "sitePage.marketplace.verifiedName": ", verified by Slavebot",
  // A screen reader reads this when a search or a category changes the list.
  "sitePage.marketplace.shownAgents": "Agents shown: {shown} of {total}",
  "sitePage.marketplace.shownSkills": "Skills shown: {shown} of {total}",
  "sitePage.marketplace.shownApps": "Apps shown: {shown} of {total}",
  "sitePage.marketplace.emptyAgentsCategory": "No agents in this category yet.",
  "sitePage.marketplace.emptySkillsCategory": "No skills in this category yet.",
  // {query} is the text in the search field.
  "sitePage.marketplace.emptyAgentsQuery": "No agents match “{query}”.",
  "sitePage.marketplace.emptySkillsQuery": "No skills match “{query}”.",
  "sitePage.marketplace.emptyApps": "No app matches.",
  "sitePage.marketplace.breadcrumb": "Breadcrumb",
  "sitePage.marketplace.addToSlavebot": "Add to Slavebot",
  // Shows after "Add to Slavebot" did not open the app.
  "sitePage.marketplace.addFromApp": "{name} is added from inside Slavebot. Get the app, then open this link again.",
  // {platform} is macOS, Windows or Linux.
  "sitePage.marketplace.downloadFor": "Download for {platform}",
  "sitePage.marketplace.copyLink": "Copy link",
  "sitePage.marketplace.copied": "Copied",
  "sitePage.marketplace.trust.agentReviewed":
    "Made by another Slavebot user. Slavebot reviewed it before it went live. It can act on your behalf once added.",
  "sitePage.marketplace.trust.agentPending":
    "Shared by its creator before Slavebot reviewed it. It can act on your behalf once added.",
  "sitePage.marketplace.trust.skillReviewed": "Made by another Slavebot user. Slavebot reviewed it before it went live.",
  "sitePage.marketplace.source.verified": "Verified by Slavebot",
  "sitePage.marketplace.source.reviewed": "Reviewed by Slavebot",
  "sitePage.marketplace.source.pending": "Not reviewed yet",
  "sitePage.marketplace.information": "Information",
  "sitePage.marketplace.fact.creator": "Creator",
  "sitePage.marketplace.fact.source": "Source",
  "sitePage.marketplace.fact.category": "Category",
  "sitePage.marketplace.fact.version": "Version",
  "sitePage.marketplace.fact.updated": "Updated",
  // {version} is a number, such as 3.
  "sitePage.marketplace.skillVersion": "Version {version}",
  // A routine that the agent brings switched off. It runs only after the user switches it on.
  "sitePage.marketplace.routineOff": "Starts off",
  "sitePage.marketplace.missing.title": "Not in the Marketplace",
  "sitePage.marketplace.missing.body": "The creator removed it, Slavebot did not approve it, or the link is wrong.",
  "sitePage.marketplace.missing.open": "Open the Marketplace",
});
