/* See license.txt for terms of usage */

define([
    "firebug/lib/trace",
    "firebug/lib/options",
    "firebug/lib/locale",
    "firebug/lib/events",
    "firebug/lib/array",
    "firebug/lib/string",
    "firebug/lib/xpcom",
    "firebug/firefox/browserOverlayLib",
    "firebug/firefox/browserCommands",
    "firebug/firefox/browserMenu",
    "firebug/firefox/browserToolbar",
    "firebug/lib/system",
    "firebug/lib/devtools",
    "firebug/lib/channel",
],
function(FBTrace, Options, Locale, Events, Arr, Str, Xpcom, BrowserOverlayLib,
    BrowserCommands, BrowserMenu, BrowserToolbar, System, DevTools, Channel) {

// ********************************************************************************************* //
// Constants

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;

var {$, $el, $stylesheet, $menuitem, $menuseparator} = BrowserOverlayLib;

Locale.registerStringBundle("chrome://firebug/locale/firebug.properties");
Locale.registerStringBundle("chrome://firebug/locale/cookies.properties");
Locale.registerStringBundle("chrome://firebug/locale/selectors.properties");
Locale.registerStringBundle("chrome://firebug/locale/keys.properties");
Locale.registerStringBundle("chrome://global-platform/locale/platformKeys.properties");
Locale.registerStringBundle("chrome://global/locale/keys.properties");
Locale.registerStringBundle("chrome://firebug/locale/multiprocess-notification.properties");

Cu.import("resource://firebug/loader.js");
Cu.import("resource://firebug/fbtrace.js");
Cu.import("resource://gre/modules/AddonManager.jsm");

var servicesScope = {};
Cu.import("resource://gre/modules/Services.jsm", servicesScope);

const firstRunPage = "https://getfirebug.com/firstrun#Firebug ";

var auroraChannel = "";
try {
  var value = servicesScope.Services.prefs.getCharPref("app.update.channel");
  auroraChannel = (value == "aurora") || (value == "nightly-gum");
}
catch (err) {
}

// xxxHonza: getfirebug.com (or just the firebug/3.0 directory) is
// surprisingly often not available.
var downloadError = "Failed to get the latest Firebug 3 XPI from:\n\n" +
    "https://getfirebug.com/releases/firebug/3.0/\n\n" +
    "Try again or download the latest XPI manually.";

// ********************************************************************************************* //
// BrowserOverlay Implementation

function BrowserOverlay(win)
{
    this.win = win;
    this.doc = win.document;
}

BrowserOverlay.prototype =
{
    // When Firebug is disabled or uninstalled this elements must be removed from
    // chrome UI (XUL).
    nodesToRemove: [],

    auroraChannel: auroraChannel,

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Initialization

    initialize: function(reason)
    {
        // Expose BrowserOverlayLib object to extensions.
        this.win.Firebug.BrowserOverlayLib = BrowserOverlayLib;

        // This element (a broadcaster) is storing Firebug state information. Other elements
        // (like for example the Firebug start button) can watch it and display the info to
        // the user.
        $el(this.doc, "broadcaster", {id: "firebugStatus", suspended: true},
            $(this.doc, "mainBroadcasterSet"));

        var node = $stylesheet(this.doc, "chrome://firebug/content/firefox/browserOverlay.css");

        if (System.isMac(this.win))
            $stylesheet(this.doc, "chrome://firebug/content/firefox/macBrowserOverlay.css");

        this.nodesToRemove.push(node);

        this.loadContextMenuOverlay();
        this.loadFirstRunPage(reason);

        var version = this.getVersion();

        BrowserCommands.overlay(this.doc);
        BrowserMenu.overlay(this);
        BrowserToolbar.overlay(this.doc, version);

        this.internationalize();
        this.allPagesActivation();
    },

    internationalize: function()
    {
        // Internationalize all elements with 'fbInternational' class. Clone
        // before internationalization.
        var elements = Arr.cloneArray(this.doc.getElementsByClassName("fbInternational"));
        Locale.internationalizeElements(this.doc, elements, ["label", "tooltiptext", "aria-label"]);
    },

    allPagesActivation: function()
    {
        // Load Firebug by default if activation is on for all pages (see issue 5522)
        if (Options.get("allPagesActivation") == "on" || !Options.get("delayLoad"))
        {
            var self = this;
            this.startFirebug(function(Firebug)
            {
                var browser = Firebug.Firefox.getBrowserForWindow(self.win);
                var uri = Firebug.Firefox.getCurrentURI();

                // Open Firebug UI (e.g. if the annotations say so, issue 5623)
                if (uri && Firebug.TabWatcher.shouldCreateContext(browser, uri.spec, null))
                    Firebug.toggleBar(true);

                FBTrace.sysout("Firebug loaded by default since 'allPagesActivation' is on " +
                    "or 'delayLoad' is false");
            });
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Load Rest of Firebug

    /**
     * This method is called by the Framework to load entire Firebug. It's executed when
     * the user requires Firebug for the first time.
     *
     * @param {Object} callback Executed when Firebug is fully loaded
     */
    startFirebug: function(callback)
    {
        // Special case for e10s enabled browser.
        if (this.isMultiprocessEnabled()) {
            this.showNewMultiprocessNotification();
            return;
        }

        /*if (this.isMultiprocessEnabled()) {
            this.showMultiprocessNotification();
            return;
        }
        else if (this.isAuroraChannel()) {
            this.showAuroraNotification();
            return;
        }*/

        if (this.win.Firebug.waitingForFirstLoad)
            return;

        if (this.win.Firebug.isInitialized)
            return callback && callback(this.win.Firebug);

        if (FBTrace.DBG_INITIALIZE)
            FBTrace.sysout("overlay; Load Firebug...", (callback ? callback.toString() : ""));

        this.win.Firebug.waitingForFirstLoad = true;

        // List of Firebug scripts that must be loaded into the global scope (browser.xul)
        // FBTrace is no longer loaded into the global space.
        var scriptSources = [
            "chrome://firebug/content/legacy.js",
            "chrome://firebug/content/moduleConfig.js"
        ];

        // Create script elements.
        var self = this;
        scriptSources.forEach(function(url)
        {
            servicesScope.Services.scriptloader.loadSubScript(url, self.doc);

            // xxxHonza: This doesn't work since Firefox 28. From some reason the script
            // isn't parsed when inserted into the second browser window. See issue 6731
            // $script(self.doc, url);
        });

        var container = $(this.doc, "appcontent");

        // Create Firebug splitter element.
        $el(this.doc, "splitter", {id: "fbContentSplitter", collapsed: "true"}, container);

        // Create Firebug main frame and container.
        $el(this.doc, "vbox", {id: "fbMainFrame", collapsed: "true", persist: "height,width"}, [
            $el(this.doc, "browser", {
                id: "fbMainContainer",
                flex: "2",
                src: "chrome://firebug/content/firefox/firebugFrame.xul",
                disablehistory: "true"
            })
        ], container);

        // When Firebug is fully loaded and initialized it fires a "FirebugLoaded"
        // event to the browser document (browser.xul scope). Wait for that to happen.
        this.doc.addEventListener("FirebugLoaded", function onLoad()
        {
            self.doc.removeEventListener("FirebugLoaded", onLoad, false);
            self.win.Firebug.waitingForFirstLoad = false;

            // xxxHonza: TODO find a better place for notifying extensions
            FirebugLoader.dispatchToScopes("firebugFrameLoad", [self.win.Firebug]);
            if (callback)
                callback(self.win.Firebug);
        }, false);
    },

    stopFirebug: function()
    {
        this.unloadContextMenuOverlay();
        BrowserCommands.resetDisabledKeys(this.win);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Firebug Menu Handlers

    onOptionsShowing: function(popup)
    {
        for (var child = popup.firstChild; child; child = child.nextSibling)
        {
            if (child.localName == "menuitem")
            {
                var option = child.getAttribute("option");
                if (option)
                {
                    var checked = Options.get(option);

                    // xxxHonza: I believe that allPagesActivation could be simple boolean option.
                    if (option == "allPagesActivation")
                        checked = (checked == "on") ? true : false;

                    child.setAttribute("checked", checked);
                }
            }
        }
    },

    onToggleOption: function(menuItem)
    {
        var option = menuItem.getAttribute("option");
        var checked = menuItem.getAttribute("checked") == "true";

        Options.set(option, checked);
    },

    onMenuShowing: function(popup, event)
    {
        // If the event comes from a sub menu, just ignore it.
        if (popup != event.target)
            return;

        while (popup.lastChild)
            popup.removeChild(popup.lastChild);

        // Generate dynamic content.
        for (var i=0; i<BrowserMenu.firebugMenuContent.length; i++)
            popup.appendChild(BrowserMenu.firebugMenuContent[i].cloneNode(true));

        var collapsed = "true";
        if (this.win.Firebug.chrome)
        {
            var fbContentBox = this.win.Firebug.chrome.$("fbContentBox");
            collapsed = fbContentBox.getAttribute("collapsed");
        }

        var currPos = Options.get("framePosition");
        var placement = this.win.Firebug.getPlacement ? this.win.Firebug.getPlacement() : "";

        // Switch between "Open Firebug" and "Hide Firebug" label in the popup menu.
        var toggleFirebug = popup.querySelector("#menu_firebug_toggleFirebug");
        if (toggleFirebug)
        {
            var hiddenUI = (collapsed == "true" || placement == "minimized");
            toggleFirebug.setAttribute("label", (hiddenUI ?
                Locale.$STR("firebug.ShowFirebug") : Locale.$STR("firebug.HideFirebug")));

            toggleFirebug.setAttribute("tooltiptext", (hiddenUI ?
                Locale.$STR("firebug.menu.tip.Open_Firebug") :
                Locale.$STR("firebug.menu.tip.Minimize_Firebug")));

            var currentLocation = toggleFirebug.ownerDocument.defaultView.top.location.href;
            var inDetachedWindow = currentLocation.indexOf("firebug.xul") > 0;

            // If Firebug is detached, use "Focus Firebug Window" label
            // instead of "Hide Firebug" when the menu isn't opened from
            // within the detached Firebug window. the 'placement' is used
            // to ensure Firebug isn't closed with close button of detached window
            // and 'inDetachedWindow' variable is also used to ensure the menu is
            // opened from within the detached window.
            if (currPos == "detached" && this.win.Firebug.currentContext &&
                placement != "minimized" && !inDetachedWindow)
            {
                toggleFirebug.setAttribute("label", Locale.$STR("firebug.FocusFirebug"));
                toggleFirebug.setAttribute("tooltiptext",
                    Locale.$STR("firebug.menu.tip.Focus_Firebug"));
            }
        }

        // Hide "Deactivate Firebug" menu if Firebug is not active.
        var closeFirebug = popup.querySelector("#menu_firebug_closeFirebug");
        if (closeFirebug)
        {
            closeFirebug.setAttribute("collapsed",
                (this.win.Firebug.currentContext ? "false" : "true"));
        }

        // Update About Menu
        var version = this.getVersion();
        if (version)
        {
            var node = popup.getElementsByClassName("firebugAbout")[0];
            var aboutLabel = node.getAttribute("label");
            node.setAttribute("label", aboutLabel + " " + version);
            node.classList.remove("firebugAbout");
        }

        // Allow Firebug menu customization (see FBTest and FBTrace as an example).
        var event = new this.win.CustomEvent("firebugMenuShowing", {detail: popup});
        this.doc.dispatchEvent(event);
    },

    onMenuHiding: function(popup, event)
    {
        if (popup != event.target)
            return;

        // xxxHonza: I don't know why the timeout must be here, but if it isn't
        // the icon menu is broken (see issue 5427)
        this.win.setTimeout(function()
        {
            while (popup.lastChild)
                popup.removeChild(popup.lastChild);
        });
    },

    onViewMenuShowing: function()
    {
        // Check whether Firebug is open
        var open = false;
        if (this.win.Firebug.chrome)
        {
            var fbContentBox = this.win.Firebug.chrome.$("fbContentBox");
            open = fbContentBox.getAttribute("collapsed") == "true" ? false : true;
        }

        var firebugViewMenuItem = this.win.document.
            getElementById("menu_firebug_viewToggleFirebug");
        firebugViewMenuItem.setAttribute("checked", open);
    },

    onPositionPopupShowing: function(popup)
    {
        while (popup.lastChild)
            popup.removeChild(popup.lastChild);

        // Load Firebug before the position is changed.
        var oncommand = "Firebug.browserOverlay.startFirebug(function(){" +
            "Firebug.chrome.setPosition('%pos%')" + "})";

        var items = [];
        var currPos = Options.get("framePosition");

        var positions = ["detached", "top", "bottom", "left", "right"];
        for (var i=0; i<positions.length; i++)
        {
            var pos = positions[i];
            var label = Str.capitalize(pos);

            var item = $menuitem(this.doc, {
                label: "firebug.menu." + label,
                tooltiptext: "firebug.menu.tip." + label,
                type: "radio",
                oncommand: oncommand.replace("%pos%", pos),
                checked: (currPos == pos)
            });

            if (pos == "detached")
                items.key = "key_firebug_detachFirebug";

            popup.appendChild(item);
        }

        return true;
    },

    openAboutDialog: function()
    {
        var self = this;

        // Firefox 4.0+
        Cu["import"]("resource://gre/modules/AddonManager.jsm");
        this.win.AddonManager.getAddonByID("firebug@software.joehewitt.com", function(addon)
        {
            self.win.openDialog("chrome://mozapps/content/extensions/about.xul", "",
                "chrome,centerscreen,modal", addon);
        });
    },

    setPosition: function(newPosition)
    {
        // todo
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Firebug PanelSelector Menu

    onPanelSelectorShowing: function(popup)
    {
        var self = this;
        this.startFirebug(function()
        {
            self.win.Firebug.PanelSelector.onMenuShowing(popup);
        });
    },

    onPanelSelectorHiding: function(popup)
    {
        var self = this;
        this.startFirebug(function()
        {
            self.win.Firebug.PanelSelector.onMenuHiding(popup);
        });
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Firebug Version

    getVersion: function()
    {
        var versionURL = "chrome://firebug/content/branch.properties";

        var loadingPrincipal = servicesScope.Services.scriptSecurityManager.getSystemPrincipal();

        var channel = Channel.new(versionURL);
        var input = channel.open();
        var sis = Cc["@mozilla.org/scriptableinputstream;1"].
            createInstance(Ci.nsIScriptableInputStream);
        sis.init(input);

        var content = sis.readBytes(input.available());
        sis.close();

        var m = /RELEASE=(.*)/.exec(content);
        if (!m)
            return "no RELEASE in " + versionURL;

        var release = m[1];

        m = /VERSION=(.*)/.exec(content);
        if (!m)
            return "no VERSION in " + versionURL;

        var version = m[1];

        return version+""+release;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // External Editors

    onEditorsShowing: function(popup)
    {
        var self = this;
        this.startFirebug(function()
        {
            self.win.Firebug.ExternalEditors.onEditorsShowing(popup);
        });

        return true;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Page Context Menu Overlay

    loadContextMenuOverlay: function()
    {
        var contextMenu = this.win.nsContextMenu;
        if (typeof(contextMenu) == "undefined")
            return;

        // isTargetAFormControl is removed, see:
        // https://bugzilla.mozilla.org/show_bug.cgi?id=433168
        if (typeof(contextMenu.prototype.isTargetAFormControl) != "undefined")
        {
            var setTargetOriginal = this.setTargetOriginal = contextMenu.prototype.setTarget;
            contextMenu.prototype.setTarget = function(aNode, aRangeParent, aRangeOffset)
            {
                setTargetOriginal.apply(this, arguments);

                if (this.isTargetAFormControl(aNode))
                    this.shouldDisplay = true;
            };
        }

        // Hide built-in inspector if the pref says so.
        var initItemsOriginal = this.initItemsOriginal = contextMenu.prototype.initItems;
        contextMenu.prototype.initItems = function()
        {
            initItemsOriginal.apply(this, arguments);

            // Hide built-in inspector menu item if the pref "extensions.firebug.hideDefaultInspector"
            // says so. Note that there is also built-in preference "devtools.inspector.enable" that
            // can be used for the same purpose.
            var hideInspect = Options.get("hideDefaultInspector");
            if (hideInspect)
            {
                this.showItem("inspect-separator", false);
                this.showItem("context-inspect", false);
            }
        };
    },

    unloadContextMenuOverlay: function()
    {
        var contextMenu = this.win.nsContextMenu;
        if (typeof(contextMenu) == "undefined")
            return;

        if (this.setTargetOriginal)
            contextMenu.prototype.setTarget = this.setTargetOriginal;

        if (this.initItemsOriginal)
            contextMenu.prototype.initItems = this.initItemsOriginal;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // First Run Page

    loadFirstRunPage: function(reason)
    {
        if (this.checkFirebugVersion(Options.get("currentVersion")) <= 0)
            return;

        // Do not show the first run page when Firebug is being updated. It'll be displayed
        // the next time the browser is restarted
        // # ADDON_UPGRADE == 7
        if (reason == 7)
            return;

        // Open the page in the top most window, so the user can see it immediately.
        var wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
        if (wm.getMostRecentWindow("navigator:browser") == this.win.top)
        {
            // Update the preference to make sure the page is not displayed again.
            // To avoid being annoying when Firefox crashes, forcibly save it, too.
            var version = this.getVersion();
            Options.set("currentVersion", version);

            if (Options.get("showFirstRunPage"))
            {
                var self = this;
                var timeout = this.win.setTimeout(function()
                {
                    if (self.win.closed)
                        return;

                    self.openFirstRunPage(self.win);
                }, 1000);

                this.win.addEventListener("unload", function()
                {
                    self.win.clearTimeout(timeout);
                }, false);
            }
        }
    },

    openFirstRunPage: function(win)
    {
        var version = this.getVersion();
        var url = firstRunPage + version;

        var browser = win.gBrowser || win.getBrowser();
        if (!browser)
        {
            FBTrace.sysout("browserOverlay.openFirstRunPage; ERROR there is no gBrowser!");
            return;
        }

        // Open the firstRunPage in background
        /*gBrowser.selectedTab = */browser.addTab(url, null, null, null);

        // Make sure prefs are stored, otherwise the firstRunPage would be displayed
        // again if Firefox crashes.
        this.win.setTimeout(function()
        {
            Options.forceSave();
        }, 400);
    },

    // xxxsz: Can't System.checkFirebugVersion() be used for that?
    checkFirebugVersion: function(currentVersion)
    {
        if (!currentVersion)
            return 1;

        var version = this.getVersion();

        // Use Firefox comparator service
        var versionChecker = Xpcom.CCSV("@mozilla.org/xpcom/version-comparator;1",
            "nsIVersionComparator");

        return versionChecker.compare(version, currentVersion);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Upgrade Firebug

    upgradeFirebug: function(event)
    {
        Events.cancelEvent(event);

        this.showUpgradeNotification();

        // Start download automatically
        this.onUpgradeFirebug(event, 'fbUpgradeNotificationPanel');
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Remote Browser (aka e10s enabled browser)

    isMultiprocessEnabled: function()
    {
        var content = $(this.doc, "content");
        if (content.mCurrentBrowser.isRemoteBrowser)
          return true;

        var browser = this.win.gBrowser || this.win.getBrowser();
        if (browser.isRemoteBrowser)
          return true;

        if (servicesScope.Services.appinfo.browserTabsRemoteAutostart)
          return true;

        return false;
    },

    isAuroraChannel: function() {
      if (this.notNow)
          return false;

      if (Options.get("noThanksFirebugNext"))
          return false;

      return auroraChannel;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Aurora notification

    showAuroraNotification: function()
    {
        var popupSet = $(this.doc, "mainPopupSet");
        var panel = this.doc.querySelector("fbAuroraNotificationPanel");
        if (!panel)
        {
            panel = this.doc.createElement("fbAuroraNotificationPanel");
            panel.setAttribute("upgradecommand", "Firebug.browserOverlay.onUpgradeFirebug(event, 'fbAuroraNotificationPanel')");
            panel.setAttribute("notnowcommand", "Firebug.browserOverlay.onNotNow(event)");
            panel.setAttribute("nothankscommand", "Firebug.browserOverlay.onNoThanks(event)");
            panel.setAttribute("cancelcommand", "Firebug.browserOverlay.onCancelUpgrade(event, 'fbAuroraNotificationPanel')");
            popupSet.appendChild(panel);
        }

        panel.internationalize(Locale);
        panel.open();
    },

    onNoThanks: function(event)
    {
        Events.cancelEvent(event);

        // Not sure why the timeout needs to be here, but the 'close'
        // method is only available asynchronously.
        this.win.setTimeout(() => {
          Options.set("noThanksFirebugNext", true);
          this.openFirebug2(event.target);
        });
    },

    onNotNow: function(event)
    {
        Events.cancelEvent(event);

        this.win.setTimeout(() => {
          this.notNow = true;
          this.openFirebug2(event.target);
        });
    },

    openFirebug2: function(panel)
    {
        var button = this.doc.getElementById("firebug-button");
        button.enableFirebugActions();
        panel.close();

        this.startFirebug(function(Firebug) {
            Firebug.toggleBar(true);
        });
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Manual upgrade panel

    showUpgradeNotification: function()
    {
        var popupSet = $(this.doc, "mainPopupSet");
        var panel = this.doc.querySelector("fbUpgradeNotificationPanel");
        if (!panel)
        {
            panel = this.doc.createElement("fbUpgradeNotificationPanel");
            panel.setAttribute("upgradecommand", "Firebug.browserOverlay.onUpgradeFirebug(event, 'fbUpgradeNotificationPanel')");
            panel.setAttribute("cancelcommand", "Firebug.browserOverlay.onCancelUpgrade(event, 'fbUpgradeNotificationPanel')");
            popupSet.appendChild(panel);
        }

        panel.internationalize(Locale);
        panel.open();
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // e10s enabled browser Notification

    showMultiprocessNotification: function()
    {
        var popupSet = $(this.doc, "mainPopupSet");
        var panel = this.doc.querySelector("fbMultiprocessNotificationPanel");
        if (!panel)
        {
            panel = this.doc.createElement("fbMultiprocessNotificationPanel");
            panel.setAttribute("upgradecommand", "Firebug.browserOverlay.onUpgradeFirebug(event, 'fbMultiprocessNotificationPanel')");
            panel.setAttribute("disablecommand", "Firebug.browserOverlay.onDisableE10s(event)");
            panel.setAttribute("cancelcommand", "Firebug.browserOverlay.onCancelUpgrade(event, 'fbMultiprocessNotificationPanel')");
            popupSet.appendChild(panel);
        }

        panel.internationalize(Locale);
        panel.open();
    },

    showNewMultiprocessNotification: function()
    {
        if (Options.get("noMultiprocessMessage"))
        {
          this.toggleDevTools();
          return;
        }

        var popupSet = $(this.doc, "mainPopupSet");
        var panel = this.doc.querySelector("fbNewMultiprocessNotificationPanel");
        if (!panel)
        {
            panel = this.doc.createElement("fbNewMultiprocessNotificationPanel");
            panel.setAttribute("opendevtoolscommand", "Firebug.browserOverlay.onOpenDevTools(event, 'fbMultiprocessNotificationPanel')");
            panel.setAttribute("disablecommand", "Firebug.browserOverlay.onDisableE10s(event)");
            popupSet.appendChild(panel);
        }

        panel.internationalize(Locale);
        panel.open();
    },

    onDisableE10s: function(event)
    {
      Events.cancelEvent(event);

      // xxxHonza: there is no other way to disable e10s that set
      // both realated prefs. It's unlikely that there will be .2
      Options.setPref("browser.tabs", "remote.autostart", false);
      Options.setPref("browser.tabs", "remote.autostart.1", false);

      var panel = this.doc.querySelector("fbNewMultiprocessNotificationPanel");
      Options.set("noMultiprocessMessage", panel.notAgain.checked);

      restartFirefox();
    },

    onOpenDevTools: function(event)
    {
      Events.cancelEvent(event);

      var panel = this.doc.querySelector("fbNewMultiprocessNotificationPanel");
      Options.set("noMultiprocessMessage", panel.notAgain.checked);

      panel.close();

      this.toggleDevTools(true);
    },

    toggleDevTools: function(forceOpen) {
      var toolbox = getToolbox(this.win);
      if (toolbox && forceOpen) {
        return;
      }

      if (toolbox) {
        destroyToolbox(this.win);
      } else {
        showToolbox(this.win);
      }
    },

    onUpgradeFirebug: function(event, panelId)
    {
        Events.cancelEvent(event);

        var self = this;
        var panel = this.doc.querySelector(panelId);

        // Listen for installation end
        var listener =
        {
          onInstallEnded: function(install, addon)
          {
              install.removeListener(listener);
              self.install = null;

              // Bug 749745: on FF14+, onInstallEnded is called just before `startup()`
              // is called, but we expect to resolve the promise only after it.
              // As startup is called synchronously just after onInstallEnded,
              // a simple setTimeout(0) is enough
              self.win.setTimeout(function()
              {
                restartFirefox();
              }, 0);
          },
          onInstallFailed: function (install)
          {
              install.removeListener(listener);
              self.install = null;

              Cu.reportError(install.error);
              Cu.reportError(downloadError);

              panel.upgradeButton.removeAttribute("collapsed");
              panel.progress.setAttribute("collapsed", "true");
              panel.cancelButton.setAttribute("collapsed", "true");

              self.win.alert(downloadError);
          },
          onDownloadFailed: function(install)
          {
              this.onInstallFailed(install);
          },
          onDownloadStarted: function(install)
          {
              panel.progress.setAttribute("value", "0");
              panel.upgradeButton.setAttribute("collapsed", "true");
              panel.progress.removeAttribute("collapsed");
              panel.cancelButton.removeAttribute("collapsed");
          },
          onDownloadProgress: function(install)
          {
              var value = install.progress / (install.maxProgress / 100);
              panel.progress.value = value;
          }
        };

        findFirebugUpdate(function(url)
        {
            if (!url)
            {
                Cu.reportError(downloadError);
                self.win.alert(downloadError);
                return;
            }

            AddonManager.getInstallForURL(url, (install) =>
            {
                install.addListener(listener);
                install.install();
                self.install = install;
            }, "application/x-xpinstall");
        });
    },

    onCancelUpgrade: function(event, panelId)
    {
        Events.cancelEvent(event);

        if (!this.install)
          return;

        this.install.cancel();
        this.install = null;

        var panel = this.doc.querySelector(panelId);
        panel.upgradeButton.removeAttribute("collapsed");
        panel.progress.setAttribute("value", "0");
        panel.progress.setAttribute("collapsed", "true");
        panel.cancelButton.setAttribute("collapsed", "true");
    },
};

// Helpers

function findFirebugUpdate(callback)
{
    var xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();
    var url = "https://getfirebug.com/releases/firebug/3.0/update.rdf";
    xhr.open("GET", url, true);

    xhr.onload = function()
    {
        if (xhr.readyState !== 4)
            return;

        if (xhr.status !== 200)
        {
            callback(null);
            return;
        }

        try
        {
            var parser = Xpcom.CCIN("@mozilla.org/xmlextras/domparser;1", "nsIDOMParser");
            var doc = parser.parseFromString(xhr.responseText, "text/xml");
            var root = doc.documentElement;
            var link = root.querySelector("updateLink");
            callback(link.textContent);
        }
        catch (err)
        {
            FBTrace.sysout("EXCEPTION " + err, err);
            callback(null);
        }
    };

    xhr.onerror = function(e)
    {
        Cu.reportError(e.target.status);
    };

    xhr.send(null);
}

function restartFirefox()
{
    Cc["@mozilla.org/toolkit/app-startup;1"].getService(Ci.nsIAppStartup).
        quit(Ci.nsIAppStartup.eRestart | Ci.nsIAppStartup.eAttemptQuit);
}

function getCurrentTab(win)
{
    let browserDoc = win.top.document;
    let browser = browserDoc.getElementById("content");
    return browser.selectedTab;
}

function showToolbox(win)
{
    let tab = getCurrentTab(win);
    let target = DevTools.devtools.TargetFactory.forTab(tab);
    return DevTools.gDevTools.showToolbox(target);
}

function destroyToolbox(win)
{
    let toolbox = getToolbox(win);
    if (toolbox) {
      return toolbox.destroy();
    }
}

function getToolbox(win)
{
    let tab = getCurrentTab(win);
    let target = DevTools.devtools.TargetFactory.forTab(tab);
    return DevTools.gDevTools.getToolbox(target);
}

// ********************************************************************************************* //
// Registration

return BrowserOverlay;

// ********************************************************************************************* //
});
