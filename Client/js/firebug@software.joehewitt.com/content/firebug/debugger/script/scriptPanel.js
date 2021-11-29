/* See license.txt for terms of usage */

define([
    "firebug/firebug",
    "firebug/lib/trace",
    "firebug/lib/object",
    "firebug/lib/locale",
    "firebug/lib/events",
    "firebug/lib/dom",
    "firebug/lib/array",
    "firebug/lib/css",
    "firebug/lib/url",
    "firebug/lib/domplate",
    "firebug/lib/persist",
    "firebug/lib/keywords",
    "firebug/lib/system",
    "firebug/lib/options",
    "firebug/lib/promise",
    "firebug/chrome/activablePanel",
    "firebug/chrome/menu",
    "firebug/chrome/rep",
    "firebug/chrome/statusPath",
    "firebug/chrome/searchBox",
    "firebug/editor/editor",
    "firebug/debugger/script/scriptView",
    "firebug/debugger/stack/stackFrame",
    "firebug/debugger/script/sourceLink",
    "firebug/debugger/script/sourceFile",
    "firebug/debugger/breakpoints/breakpoint",
    "firebug/debugger/breakpoints/breakpointStore",
    "firebug/debugger/breakpoints/breakpointConditionEditor",
    "firebug/debugger/breakpoints/breakOnNext",
    "firebug/debugger/script/scriptPanelWarning",
    "firebug/debugger/script/breakNotification",
    "firebug/debugger/script/scriptPanelLineUpdater",
    "firebug/debugger/debuggerLib",
    "firebug/console/commandLine",
    "arch/compilationunit",
],
function (Firebug, FBTrace, Obj, Locale, Events, Dom, Arr, Css, Url, Domplate, Persist, Keywords,
    System, Options, Promise, ActivablePanel, Menu, Rep, StatusPath, SearchBox, Editor, ScriptView,
    StackFrame, SourceLink, SourceFile, Breakpoint, BreakpointStore, BreakpointConditionEditor,
    BreakOnNext, ScriptPanelWarning, BreakNotification, ScriptPanelLineUpdater,
    DebuggerLib, CommandLine, CompilationUnit) {

"use strict";

// ********************************************************************************************* //
// Constants

var {domplate, DIV} = Domplate;

var TraceError = FBTrace.toError();
var Trace = FBTrace.to("DBG_SCRIPTPANEL");

// ********************************************************************************************* //
// Script panel

/**
 * @Panel This object represents the 'Script' panel that is used for debugging JavaScript.
 * This panel is using JSD2 API for debugging.
 */
function ScriptPanel() {}
var BasePanel = ActivablePanel;
ScriptPanel.prototype = Obj.extend(BasePanel,
/** @lends ScriptPanel */
{
    dispatchName: "ScriptPanel",

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // extends Panel

    name: "script",
    searchable: true,
    searchPlaceholder: "Use_hash_plus_number_to_go_to_line",
    breakable: true,
    enableA11y: true,
    order: 40,

    // {@link StatusPath} UI component that displays call-stack in the toolbar will be
    // updated asynchronously.
    objectPathAsyncUpdate: true,

    // Will appear in detached Firebug Remote XUL window.
    remotable: true,

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Initialization

    initialize: function(context, doc)
    {
        Trace.sysout("scriptPanel.initialize; " + context.getName());

        BasePanel.initialize.apply(this, arguments);

        this.panelSplitter = Firebug.chrome.$("fbPanelSplitter");
        this.sidePanelDeck = Firebug.chrome.$("fbSidePanelDeck");

        // Create source view for JS source code. Initialization is made when the Script
        // panel is actually displayed (in 'show' method).
        this.scriptView = new ScriptView();
        this.scriptView.addListener(this);

        // The tool/controller (serves as a proxy to the back-end service) is registered dynamically.
        // Depending on the current tool the communication can be local or remote.
        // Access to the back-end debugger service (JSD2) must always be done through the tool.
        this.tool = this.context.getTool("debugger");
        this.tool.addListener(this);

        this.context.getTool("breakpoint").addListener(this);
        this.context.getTool("source").addListener(this);

        BreakOnNext.addListener(this);

        // Register as a listener for 'updateSidePanels' event.
        Firebug.registerUIListener(this);
    },

    initializeNode : function()
    {
        this.onResizer = this.onResize.bind(this);
        this.resizeEventTarget = Firebug.chrome.$("fbContentBox");
        Events.addEventListener(this.panelNode, "resize", this.onResizer, true);

        BasePanel.initializeNode.apply(this, arguments);
    },

    destroyNode : function()
    {
        Events.removeEventListener(this.panelNode, "resize", this.onResizer, true);

        BasePanel.destroyNode.apply(this, arguments);
    },

    destroy: function(state)
    {
        // We want the location (compilationUnit) to persist, not the selection (e.g. stackFrame).
        this.selection = null;

        Trace.sysout("scriptPanel.destroy; " + state.scrollTop + ", " + state.location, state);

        this.scriptView.removeListener(this);
        this.scriptView.destroy();

        this.tool.removeListener(this);

        this.context.getTool("breakpoint").removeListener(this);
        this.context.getTool("source").removeListener(this);

        Firebug.unregisterUIListener(this);

        // Stop marking executable lines.
        if (this.context.markExeLinesTimeout)
        {
            this.context.clearTimeout(this.context.markExeLinesTimeout);
            this.context.markExeLinesTimeout = null;
        }

        BasePanel.destroy.apply(this, arguments);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Panel show/hide

    show: function(state)
    {
        var enabled = this.isEnabled();
        if (!enabled)
            return;

        var active = !ScriptPanelWarning.showWarning(this);

        Trace.sysout("scriptPanel.show; active: " + active + ", " + this.context.getName(), {
            location: state ? state.location : null,
            scrollTop: state ? state.scrollTop : null,
            topLine: state ? state.topLine : null,
        });

        // Initialize the source view.
        // xxxHonza: from some reason the script is not visible the first time
        // Firebug is opened if this is done in scriptPanel.initialize.
        // Do not initialize the script view if the panel is not active (e.g. the debugger
        // is stopped in another tab), it would be asynchronously displayed over the
        // displayed warning message.
        if (active)
            this.scriptView.initialize(this.panelNode);

        if (active && state && state.location)
        {
            // Create source link used to restore script view location. In this specific
            // case scroll (pixel) position is used ('scrollTop' option set), so the
            // location is accurate (not rounded to lines).
            var sourceLink = new SourceLink(state.location.getURL(), state.topLine, "js");
            sourceLink.options.scrollTop = state.scrollTop;

            // We don't want to highlight the top line when the content of the Script panel
            // is just restored and scrolled to the right line.
            sourceLink.options.highlight = false;

            // Causes the Script panel to show the proper location.
            // Do not highlight the line (second argument true), we just want
            // to restore the position.
            // Also do it asynchronously, the script doesn't have to be
            // available immediately.
            this.showSourceLinkAsync(sourceLink);

            // Do not restore the location again, it could happen during
            // the single stepping and overwrite the debugger location.
            delete state.location;
        }

        // These buttons are visible only, if debugger is enabled.
        this.showToolbarButtons("fbBonButtons", active);
        this.showToolbarButtons("fbLocationSeparator", false);
        this.showToolbarButtons("fbLocationButtons", active);
        this.showToolbarButtons("fbDebuggerButtons", active);
        this.showToolbarButtons("fbScriptsButtons", active);
        this.showToolbarButtons("fbScriptButtons", active);
        this.showToolbarButtons("fbStatusButtons", active);
        this.showToolbarButtons("fbLocationList", active);

        // Additional debugger panels are visible only, if debugger is active and only
        // if they aren't explicitly hidden.
        if (Options.get("scriptHideSidePanels"))
            active = false;

        this.panelSplitter.collapsed = !active;
        this.sidePanelDeck.collapsed = !active;

        this.syncCommands(this.context);
    },

    hide: function(state)
    {
        Trace.sysout("scriptPanel.hide: ", state);

        if (!state)
        {
            TraceError.sysout("scriptPanel.hide; ERROR null state?");
            return;
        }

        state.location = this.location;

        if (this.scriptView.initialized)
        {
            state.topLine = this.scriptView.getScrollTop();
            state.scrollTop = this.scriptView.getScrollInfo().top;
        }
    },

    loadWindow: function(context, win)
    {
        // If the Script panel displays a 'no script' warning, let's try to update it.
        // The page has been just loaded and there might be some new scripts after all.
        if (!this.location)
            this.navigate(null);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Editor Size Update

    onResize: function()
    {
        var editor = this.panelNode.querySelector(".CodeMirror");
        if (!editor)
            return;

        var box = this.panelNode.querySelector(".notificationBox");
        if (!box)
            editor.style.height = "";
        else
            editor.style.height = (this.panelNode.clientHeight - box.clientHeight) + "px";
    },

    onNotificationShow: function()
    {
        this.onResize();
    },

    onNotificationHide: function()
    {
        this.onResize();
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    updateSidePanels: function(panel)
    {
        if (!panel || panel.name != "script")
            return;

        // Update visibility of the side panels. The side panels could have been displayed
        // by the logic within FirebugChrome.syncSidePanels();
        // xxxHonza: the panel content doesn't have to be rendered in this case.
        var active = !ScriptPanelWarning.showWarning(this);
        this.panelSplitter.collapsed = !active;
        this.sidePanelDeck.collapsed = !active;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Show Stack Frames

    showStackFrame: function(frame)
    {
        if (this.context.stopped)
            this.showStackFrameTrue(frame);
        else
            this.showNoStackFrame();
    },

    showStackFrameTrue: function(frame)
    {
        // Make sure the current frame seen by the user is set (issue 4818)
        this.context.currentFrame = frame;

        Trace.sysout("scriptPanel.showStackFrame: " + frame, frame);

        if (this.context.breakingCause)
            this.context.breakingCause.lineNo = frame.getLineNumber();

        this.navigate(frame.toSourceLink());
    },

    showNoStackFrame: function()
    {
        this.removeDebugLocation();

        // Clear the stack on the panel toolbar, but only if the Script panel is
        // the currently selected panel.
        if (this.isSelected())
            StatusPath.clear();

        this.updateInfoTip();
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Selection

    updateSelection: function(object)
    {
        if (Trace.active)
        {
            Trace.sysout("scriptPanel.updateSelection; object:" + object + " of type " +
                typeof(object), object);

            if (object instanceof CompilationUnit)
                Trace.sysout("scriptPanel.updateSelection; this.navigate(object)", object);
            else if (object instanceof SourceLink)
                Trace.sysout("scriptPanel.updateSelection; this.showSourceLink(object)", object);
            else if (typeof(object) == "function")
                Trace.sysout("scriptPanel.updateSelection; this.showFunction(object)", object);
            else if (object instanceof StackFrame)
                Trace.sysout("scriptPanel.updateSelection; this.showStackFrame(object)", object);
            else
                Trace.sysout("scriptPanel.updateSelection; this.showStackFrame(null)", object);
        }

        if (object instanceof CompilationUnit)
            this.navigate(object);
        else if (object instanceof SourceLink)
            this.showSourceLink(object);
        else if (typeof(object) == "function")
            this.showFunction(object);
        else if (object instanceof StackFrame)
            this.showStackFrame(object);
    },

    showSourceLink: function(sourceLink)
    {
        // Show the source only if the target source file actually exists.
        if (SourceFile.getSourceFileByUrl(this.context, sourceLink.href))
            this.navigate(sourceLink);
    },

    showFunction: function(fn)
    {
        Trace.sysout("scriptPanel.showFunction; " + fn, fn);

        var sourceLink = SourceFile.findSourceForFunction(fn, this.context);
        if (sourceLink)
        {
            this.showSourceLink(sourceLink);
        }
        else
        {
            // Want to avoid the Script panel if possible
            TraceError.sysout("no sourcelink for function");
        }
    },

    /**
     * Some source files (compilation units) can be loaded asynchronously (e.g. when using
     * RequireJS). If this case happens, this method tries it again after a short timeout.
     *
     * @param {Object} sourceLink  Link to the script and line to be displayed.
     * @param {Boolean} noHighlight Do not highlight the line
     * @param {Number} counter  Number of async attempts.
     */
    showSourceLinkAsync: function(sourceLink, counter)
    {
        Trace.sysout("scriptPanel.showSourceLinkAsync; " + counter + ", " +
            sourceLink, sourceLink);

        var compilationUnit = this.context.getCompilationUnit(sourceLink.href);
        if (compilationUnit)
        {
            this.showSourceLink(sourceLink);
        }
        else
        {
            if (typeof(counter) == "undefined")
                counter = 15;

            // Stop trying. The target script is probably not going to appear. At least,
            // make sure default script (location) is displayed.
            if (counter <= 0)
            {
                if (!this.location)
                    this.navigate(null);
                return;
            }

            var self = this;
            this.context.setTimeout(function()
            {
                // If JS execution is stopped at a breakpoint, do not restore the previous
                // location. The user wants to see the breakpoint now.
                if (!self.context.stopped)
                    self.showSourceLinkAsync(sourceLink, --counter);
            }, 50);
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Scrolling & Highlighting

    scrollToLine: function(lineNo, options)
    {
        this.scriptView.scrollToLine(lineNo, options);
    },

    removeDebugLocation: function()
    {
        this.scriptView.setDebugLocation(-1, true);
    },

    setDebugLocation: function(lineNo, noScroll)
    {
        this.scriptView.setDebugLocation(lineNo, noScroll);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Location List

    showThisCompilationUnit: function(compilationUnit)
    {
        if (!compilationUnit.getURL())
        {
            TraceError.sysout("scriptPanel.showThisCompilationUnit; no URL?");
            return false;
        }

        if (compilationUnit.getURL().lastIndexOf("chrome://", 0) === 0)
            return false;

        if (compilationUnit.getKind() === CompilationUnit.EVAL && !this.showEvals)
            return false;

        if (compilationUnit.getKind() === CompilationUnit.BROWSER_GENERATED && !this.showEvents)
            return false;

        return true;
    },

    getLocationList: function()
    {
        var allSources = this.context.getAllCompilationUnits();

        if (!allSources.length)
            return [];

        var filter = Options.get("scriptsFilter");
        this.showEvents = (filter == "all" || filter == "events");
        this.showEvals = (filter == "all" || filter == "evals");

        var list = [];
        for (var i = 0; i < allSources.length; i++)
        {
            if (this.showThisCompilationUnit(allSources[i]))
            {
                list.push(allSources[i]);
            }
            else
            {
                Trace.sysout("scriptPanel.getLocationList; filtered " + allSources[i].getURL(),
                    allSources[i]);
            }
        }

        if (!list.length && allSources.length)
            this.context.allScriptsWereFiltered = true;
        else
            delete this.context.allScriptsWereFiltered;

        Trace.sysout("scriptPanel.getLocationList; enabledOnLoad: " +
            this.context.onLoadWindowContent + " all:" + allSources.length + " filtered:" +
            list.length + " allFiltered: " + this.context.allScriptsWereFiltered, list);

        return list;
    },

    getDefaultCompilationUnit: function()
    {
        var compilationUnits = this.getLocationList();
        if (compilationUnits.length)
            return compilationUnits[0];

        return null;
    },

    getDefaultLocation: function()
    {
        var compilationUnit = this.getDefaultCompilationUnit()
        if (!compilationUnit)
            return null;

        // Mark the default link as 'no highlight'. We don't want to highlight
        // the first line when a default file is automatically displayed in
        // the Script panel.
        var sourceLink = new SourceLink(compilationUnit.getURL(), null, "js");
        sourceLink.options.highlight = false;

        return sourceLink;
    },

    getObjectLocation: function(compilationUnit)
    {
        return compilationUnit.getURL();
    },

    updateLocation: function(object)
    {
        Trace.sysout("scriptPanel.updateLocation; " + object, object);

        // Make sure to update panel's content. If there is currently a warning displayed
        // it might disappears since no longer valid (e.g. "Debugger is already active").
        if (ScriptPanelWarning.updateLocation(this))
            return;

        var sourceLink = object;

        if (object instanceof CompilationUnit)
            sourceLink = new SourceLink(object.getURL(), null, "js");

        if (sourceLink instanceof SourceLink)
            this.showSource(sourceLink);

        Events.dispatch(this.fbListeners, "onUpdateScriptLocation", [this, sourceLink]);
    },

    /**
     * Always return {@link CompilationUnit} instance. The method should always return
     * an object that is also used within the location list (built in getLocationList method).
     */
    normalizeLocation: function(object)
    {
        if (object instanceof CompilationUnit)
            return object;

        if (object instanceof SourceLink)
            return this.context.getCompilationUnit(object.href);

        TraceError.sysout("scriptPanel.normalizeLocation; Unknown location! ", object);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    getCurrentURL: function()
    {
        if (this.location instanceof CompilationUnit)
            return this.location.getURL();

        if (this.location instanceof SourceLink)
            return this.location.getURL();
    },

    getCompilationUnit: function()
    {
        return this.normalizeLocation(this.location);
    },

    getSourceFile: function()
    {
        return this.context.getSourceFile(this.location.href);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // ActivablePanel

    /**
     * Class method. It's called by the framework when an instance of this panel type
     * is enabled or disabled.
     */
    onActivationChanged: function(enable)
    {
        Trace.sysout("scriptPanel.onActivationChanged; " + enable);

        // xxxHonza: needs to be revisited
        if (enable)
        {
            Firebug.Debugger.addObserver(this);
        }
        else
        {
            Firebug.Debugger.removeObserver(this);
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Status Path (callstack)

    framesadded: function(stackTrace)
    {
        Trace.sysout("scriptPanel.framesadded;", stackTrace);

        // Invoke synchronous breadcrumbs update.
        Firebug.chrome.syncStatusPath();
        StatusPath.flush();

        // Do not use: Firebug.chrome.select(this.context.currentFrame, "script");
        // at this moment. Since it invokes updateSelection, showStackFrame and
        // ends up with updating the scroll position, so the current debugging line
        // is visible to the user. It's wrong in the case where the user just
        // executed an expression on the command line, which also causes 'framesadded'
        // to be received (through clearScopes). See also issue 7028.

        // If frames are added make sure to update the selection (issue 7320)
        this.selection = this.context.currentFrame;

        // xxxHonza: Script panel side-panels derive the current selection object from
        // the Script panel (see onSelectedSidePanel in chrome.js) and those selection
        // should be also updated. How to do it properly?
        // There doesn't seem to be a public problem with this, but the internal state
        // should be correct.
        // Note that the way how selection of side panels is derived from the main
        // panel has been rather confusing over time, but extension might depend
        // on it, so it's rather hard to change it.
    },

    framescleared: function()
    {
        Trace.sysout("scriptPanel.framescleared;");

        Firebug.chrome.syncStatusPath();
    },

    getObjectPath: function(frame)
    {
        Trace.sysout("scriptPanel.getObjectPath; frame " + frame, frame);

        if (this.context.currentTrace)
            return this.context.currentTrace.frames;
    },

    getCurrentObject: function()
    {
        // If the debugger is halted the emphasized object in the status path (i.e. callstack)
        // is always the current frame (can be changed through the Callstack panel).
        if (this.context.currentFrame)
            return this.context.currentFrame;

        // If the debugger isn't halted the status path is hidden, but still, let's return
        // the default value (the current panel selection).
        return BasePanel.getCurrentObject.apply(this, arguments);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Source

    showSource: function(sourceLink)
    {
        Trace.sysout("scriptPanel.showSource; " + sourceLink, sourceLink);

        var compilationUnit = this.context.getCompilationUnit(sourceLink.href);
        if (!compilationUnit)
            compilationUnit = this.getDefaultCompilationUnit();

        // Sources doesn't have to be fetched from the server yet. In such case there
        // are not compilation units and so, no default location. We need to just wait
        // since sources are coming asynchronously (the UI will auto update after
        // 'newSource' event).
        if (!compilationUnit)
            return;

        function callback(unit, firstLineNumber, lastLineNumber, lines)
        {
            // There could have been more asynchronous requests done at the same time
            // (e.g. show default script and restore the last visible script).
            // Use only the callback that corresponds to the current location URL.
            if (!this.location || this.location.getURL() != unit.getURL())
            {
                Trace.sysout("scriptPanel.showSource; Bail out, different location now");
                return;
            }

            Trace.sysout("scriptPanel.showSource; callback " + sourceLink, sourceLink);

            // Get proper category of the target source file. This is needed by
            // the underlying source view that picking the right highlighting mode
            // for the source text (see issue 6866).
            // 1) First get the source file
            // 2) Get its content type that should be set at this moment. If not set
            //     it's guessed according to the file extension.
            // 3) Get the type/category from the content type.
            var sourceFile = SourceFile.getSourceFileByUrl(this.context, sourceLink.href);
            var category = sourceFile.getCategory();

            this.setPrettyPrintState();

            // Display the source.
            this.scriptView.showSource(lines.join(""), category);

            var options = sourceLink.getOptions();

            // Make sure the current execution line is marked if the current frame
            // is coming from the same location. Otherwise the 'debug location' flag
            // must be removed.
            var frame = this.context.currentFrame;
            if (frame && frame.href == this.location.href)
                this.setDebugLocation(frame.line - 1, true);
            else
                options.debugLocation = false;

            // If the location object is SourceLink automatically scroll to the
            // specified line. Otherwise make sure to reset the scroll position
            // to the top since new script is probably just being displayed.
            if (this.location instanceof SourceLink)
                this.scrollToLine(this.location.line, options);
            else
                this.scrollToLine(1);
        }

        compilationUnit.getSourceLines(-1, -1, callback.bind(this));
    },

    onSourceLoaded: function(sourceFile, lines)
    {
        Trace.sysout("debugger.SourceLoaded; " + sourceFile.href);

        if (!this.location || this.location.href != sourceFile.href)
            return;

        this.scriptView.showSource(sourceFile.lines.join(""), "js");

        this.context.invalidatePanels("breakpoints");
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Search

    /**
     * Executed by the framework when the user uses the {@link SearchBox} box (located
     * on the right side of the main Firebug toolbar) to search within the Script panel.
     */
    search: function(text, reverse)
    {
        Trace.sysout("scriptPanel.search; " + text + ", reverse: " + reverse);

        // Ignore empty searches, but keep the current selection.
        if (!text)
            return;

        // Check if the search is for a line number.
        var m = /^[^\\]?#(\d*)$/.exec(text);
        if (m)
        {
            // Don't beep if only a # has been typed.
            if (!m[1])
                return true;

            var lineNo = +m[1];
            if (!isNaN(lineNo) && 0 < lineNo && lineNo <= this.scriptView.editor.getLineCount())
            {
                this.scrollToLine(lineNo, {highlight: true});
                return true;
            }
        }

        var searchGlobal = Options.get("searchGlobal");
        var curDoc = this.searchCurrentDoc(!searchGlobal, text, reverse);
        if (!curDoc && searchGlobal)
            return this.searchOtherDocs(text, reverse);

        Trace.sysout("scriptPanel.search; result: " + curDoc, curDoc);

        return curDoc;
    },

    searchOtherDocs: function(text, reverse)
    {
        Trace.sysout("scriptPanel.searchOtherDocs; text: " + text);

        var scanRE = SearchBox.getTestingRegex(text);

        function scanDoc(compilationUnit)
        {
            var deferred = Promise.defer();

            function callback(unit, firstLineNumber, lastLineNumber, lines)
            {
                Trace.sysout("scriptPanel.searchOtherDocs; Source loaded for: " +
                    unit.url + " (" + lines.length + ")", lines);

                if (!lines)
                {
                    deferred.resolve(false);
                    return;
                }

                // We don't care about reverse here as we are just looking for existence.
                // If we do have a result, we will handle the reverse logic on display.
                for (var i = 0; i < lines.length; i++)
                {
                    if (scanRE.test(lines[i]))
                    {
                        deferred.resolve(true);
                        return;
                    }
                }

                deferred.resolve(false);
            }

            Trace.sysout("scriptPanel.searchOtherDocs; Source loading... " +
                compilationUnit.url, compilationUnit);

            //xxxHonza: As soon as {@link SourceFile.loadScriptLines} returns a promise
            // we can nicely use it as direct return value.
            compilationUnit.getSourceLines(-1, -1, callback.bind(this));

            // Get source might happen asynchronously. Return a promise so,
            // the caller can wait for it.
            return deferred.promise;
        }

        // Get current document (location). We need an instance that is also
        // used within the location list.
        var doc = this.context.getCompilationUnit(this.location.href);

        // Navigate to the next document that has at least one search match.
        // Each document is tested using the 'scanDoc' callback.
        // The return value is a promise (returned from 'scanDoc') that is resolved
        // to true if a document has been found, it's resolved to false otherwise.
        var result = this.navigateToNextDocument(scanDoc, reverse, doc);

        // The final result is a promise resolved with the result of searchCurrentDoc below
        // (if found == true), so the {@link SearchBox} will be able to (asynchronously)
        // update itself.
        return result.then((found) =>
        {
            Trace.sysout("scriptPanel.searchOtherDocs; next doc found: " + found);

            if (found)
                return this.searchCurrentDoc(true, text, reverse);
        });
    },

    searchCurrentDoc: function(wrapSearch, text, reverse)
    {
        Trace.sysout("scriptPanel.searchCurrentDoc; wrapSearch: " + wrapSearch +
            ", text: " + text + ", reverse: " + reverse, this.currentSearch);

        var options =
        {
            ignoreCase: !SearchBox.isCaseSensitive(text),
            backwards: reverse,
            wrapSearch: wrapSearch,
            useRegularExpression: Options.get("searchUseRegularExpression")
        };

        var wraparound = false;

        // If the search keyword is the same reuse the current search object,
        // otherwise create new one.
        if (this.currentSearch && this.currentSearch.text == text)
        {
            // In case of "multiple files" search the next document could have been
            // displayed in the UI. In such case:
            // 1) Check if it's the same document the search started in (wraparound)
            // 2) Reset start position where the search should begin.
            if (this.currentSearch.href != this.location.href)
            {
                // If true, we reached the original document this search started in
                // (this search == this search keyword)
                wraparound = (this.location.href == this.currentSearch.originalHref);

                // Searching in the next document starts from the beginning or,
                // in case of reverse search, from the end.
                this.currentSearch.start = reverse ? -1 : 0;
                this.currentSearch.href = this.location.href;
            }
            else
            {
                options.start = this.currentSearch.start;
                if (reverse)
                    options.start.ch -= 1;
            }
        }
        else
        {
            this.currentSearch = {
                text: text,
                start: reverse ? -1 : 0,
                href: this.location.href,
                originalHref: this.location.href
            };

            options.start = this.currentSearch.start;

            Trace.sysout("scriptPanel.searchCurrentDoc; new current search created: ",
                this.currentSearch);
        }

        // Search for the next occurrence of the search keyword in the document.
        var offsets = this.scriptView.search(text, options);
        if (offsets)
            this.currentSearch.start = reverse ? offsets.start : offsets.end;

        var result = !!offsets;

        if (wraparound || offsets && offsets.wraparound)
        {
            Trace.sysout("scriptPanel.searchCurrentDoc; wraparound active");

            // Return "wraparound" as the result value if the search found a match,
            // but reached the end/begin of the document and start from begin/end again.
            // xxxHonza: dispatch an event: see issue 7159
            if (result)
                result = "wraparound";
        }

        Trace.sysout("scriptPanel.searchCurrentDoc; " + this.location.href +
            ", result: " + result + ", wrapSearch: " + wrapSearch,
            {currentSearch: this.currentSearch, offsets: offsets});

        return result;
    },

    getSearchOptionsMenuItems: function()
    {
        return [
            SearchBox.searchOptionMenu("search.Case_Sensitive", "searchCaseSensitive",
                "search.tip.Case_Sensitive"),
            SearchBox.searchOptionMenu("search.Multiple_Files", "searchGlobal",
                "search.tip.Multiple_Files"),
            SearchBox.searchOptionMenu("search.Use_Regular_Expression",
                "searchUseRegularExpression", "search.tip.Use_Regular_Expression")
        ];
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // ScriptView Listener

    addBreakpoint: function(bp)
    {
        Trace.sysout("scriptPanel.addBreakpoint;", bp);

        var url = this.getCurrentURL();
        BreakpointStore.addBreakpoint(url, bp.line, bp.condition);

        // Enable by default.
        if (bp.condition == null)
            BreakpointStore.enableBreakpoint(url, bp.line);
    },

    removeBreakpoint: function(bp)
    {
        Trace.sysout("scriptPanel.removeBreakpoint;", bp);

        // Remove the breakpoint from the client side store. Breakpoint store
        // will notify all listeners (all Script panel including this one)
        // about breakpoint removal and so, it can be removed from all contexts
        var url = this.getCurrentURL();
        BreakpointStore.removeBreakpoint(url, bp.line);
    },

    disableBreakpoint: function(lineIndex, event)
    {
        Trace.sysout("scriptPanel.disableBreakpoint; line: " + lineIndex, event);

        this.toggleDisableBreakpoint(lineIndex);

        Events.cancelEvent(event);
    },

    getBreakpoints: function(breakpoints)
    {
        var url = this.getCurrentURL();
        if (!url)
            return;

        // Get only standard breakpoints. Breakpoints for errors or monitors, etc.
        // Are not displayed in the breakpoint column.
        // Do not get dynamic breakpoints either (second argument false).
        BreakpointStore.enumerateBreakpoints(url, false, function(bp)
        {
            // xxxHonza: perhaps we should pass only line numbers to the ScriptView?
            breakpoints.push(bp);
        });
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Conditional Breakpoints

    startBreakpointConditionEditor: function(lineIndex, event)
    {
        Trace.sysout("scriptPanel.startBreakpointConditionEditor; line: " + lineIndex, event);

        this.initializeEditBreakpointCondition(lineIndex);

        Events.cancelEvent(event);
    },

    onEditorKeyDown: function(event)
    {
        if (event.keyCode === KeyEvent.DOM_VK_L && Events.isControl(event))
        {
            var searchBox = Firebug.chrome.$("fbSearchBox");
            searchBox.focus();
            searchBox.value = "#";
            Events.cancelEvent(event);
        }
        if (event.keyCode === KeyEvent.DOM_VK_W && Events.isAlt(event))
        {
            this.addSelectionWatch();
            Events.cancelEvent(event);
        }
    },

    initializeEditBreakpointCondition: function(lineNo)
    {
        Trace.sysout("scriptPanel.initializeEditBreakpointCondition; " + lineNo);

        var url = this.getCurrentURL();
        var editor = this.getEditor();

        // The breakpoint doesn't have to exist. The editor can be also opened
        // at line with no breakpoint. The breakpoint will be created eventually if the
        // user creates a condition.
        var bp = BreakpointStore.findBreakpoint(url, lineNo);
        if (bp)
        {
            // Reference to the edited breakpoint.
            editor.breakpoint = bp;

            // If there is already a bp, the line is executable, so we just need to
            // open the editor.
            this.openBreakpointConditionEditor(lineNo, bp.condition);
            return;
        }

        // xxxHonza: displaying BP conditions in the Watch panel is not supported yet.
        /*if (condition)
        {
            var watchPanel = this.context.getPanel("watches", true);
            watchPanel.removeWatch(condition);
            watchPanel.rebuild();
        }*/

        // Create helper object for remembering the line and URL. It's used when
        // the user right clicks on a line with no breakpoint and picks
        // Edit Breakpoint Condition. This should still work and the breakpoint
        // should be created automatically if the user provide a condition.
        var tempBp = {
            lineNo: lineNo,
            href: url,
            condition: "",
        };

        editor.breakpoint = tempBp;
        this.scriptView.initializeBreakpoint(lineNo, tempBp.condition);
    },

    openBreakpointConditionEditor: function(lineNo, condition, originalLineNo)
    {
        Trace.sysout("scriptPanel.openBreakpointConditionEditor; " + lineNo +
            ", condition: " + condition + ", original line: " + originalLineNo);

        var bp = BreakpointStore.findBreakpoint(this.getCurrentURL(), lineNo);
        var target = null;

        if (!bp)
        {
            // If a bp didn't exist at the line, loading icon is showing
            // and it needs to be removed.
            // The loading icon isn't shown if the user wanted to set a condition
            // on an existing bp (See initializeEditBreakpointCondition()).
            this.scriptView.removeBreakpoint({lineNo: lineNo});
        }
        else
        {
            // There is already a bp at the line, so get the element (target)
            // of bp icon. we should also verify if the bp is a conditional
            // bp, if so, load the expression into the editor.
            target = this.scriptView.getGutterMarkerTarget(lineNo);
            condition = bp.condition;
        }

        if (!target)
        {
            this.scriptView.addBreakpoint({lineNo: lineNo});
            target = this.scriptView.getGutterMarkerTarget(lineNo);
        }

        var conditionEditor = this.getEditor();
        if (!conditionEditor.breakpoint)
        {
            // xxxHonza: Another reason why Conditional Editor feature needs refactoring.
            TraceError.sysout("ScriptPanel.openBreakpointConditionEditor; ERROR " +
                "conditionEditor.breakpoint == null?");
            return;
        }

        conditionEditor.breakpoint.lineNo = lineNo;

        // As Editor scrolls(not panel itself) with long scripts, we need to set
        // scrollTop manually to show the editor properly(at the right y coord).
        // getScrollInfo() can return null if the underlying editor is not
        // initialized, but it should never happen at this moment.
        this.scrollTop = this.scriptView.getScrollInfo().top;

        Editor.startEditing(target, condition, null, null, this);
    },

    onSetBreakpointCondition: function(bp, value, cancel)
    {
        Trace.sysout("scriptPanel.onSetBreakpointCondition; " + value + "cancel: " + cancel, bp);

        var availableBp = BreakpointStore.findBreakpoint(bp.href, bp.lineNo);

        if (!cancel)
        {
            if (!availableBp)
                this.addBreakpoint({line: bp.lineNo});

            value = value ? value : null;
            BreakpointStore.setBreakpointCondition(bp.href, bp.lineNo, value);
        }
        else
        {
            if (!availableBp)
                this.scriptView.removeBreakpoint({lineNo: bp.lineNo});
        }
    },

    getEditor: function(target, value)
    {
        if (!this.conditionEditor)
        {
            var sourceEditor = this.scriptView.getInternalEditor();
            this.conditionEditor = new BreakpointConditionEditor(this.document, sourceEditor);
            this.conditionEditor.callback = this.onSetBreakpointCondition.bind(this);
        }

        return this.conditionEditor;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // BreakpointTool Listener

    onBreakpointAdded: function(context, bp)
    {
        // The Script panel displays only standard (BP_NORMAL) breakpoints.
        if (!bp.isNormal())
            return;

        // The script panel is only interested in breakpoints coming from the same URL.
        var url = this.getCurrentURL();
        if (bp.href != url)
            return;

        Trace.sysout("scriptPanel.onBreakpointAdded; origin line: " +
            bp.params.originLineNo, bp);

        // Update the UI, remove the temporary(loading) bp icon. Note that the
        // original line can be zero.
        if (typeof(bp.params.originLineNo) != "undefined")
            this.scriptView.removeBreakpoint({lineNo: bp.params.originLineNo});
        else
            this.scriptView.removeBreakpoint({lineNo: bp.lineNo});

        // Now insert the breakpoint at the right location.
        this.scriptView.addBreakpoint(bp);

        // If BP condition is set, the breakpoint has been initialized by the condition
        // editor. Note that the editor can be opened even on line with no breakpoint
        // and is such case the bp is created after the condition is set.
        // The breakpoint has been already created on the server side at this point,
        // (its line location corrected), and we can now continue with the editor opening.
        if (bp.condition != null)
        {
            // Just open the condition editor at the corrected line.
            this.openBreakpointConditionEditor(bp.lineNo, bp.condition, bp.params.originLineNo);
        }
    },

    onBreakpointRemoved: function(context, bp)
    {
        // The script panel is only interested in breakpoints coming from the same URL.
        var url = this.getCurrentURL();
        if (bp.href != url)
            return;

        var bps = [];
        this.getBreakpoints(bps);

        // Don't remove the icon from the breakpoint column if there is still
        // a breakpoint in the store (see also issue 7372).
        for (var tempBp of bps)
        {
            if (tempBp.lineNo == bp.lineNo)
                return;
        }

        // Remove breakpoint from the UI.
        this.scriptView.removeBreakpoint(bp);

        Trace.sysout("scriptPanel.onBreakpointRemoved;", bp);

        var editor = this.scriptView.getInternalEditor();
        if (editor && editor.debugLocation == bp.lineNo)
            this.scriptView.setDebugLocation(bp.lineNo, true);
    },

    onBreakpointEnabled: function(context, bp, bpClient)
    {
        var url = this.getCurrentURL();
        if (bp.href == url)
            this.scriptView.updateBreakpoint(bp);
    },

    onBreakpointDisabled: function(context, bp, bpClient)
    {
        var url = this.getCurrentURL();
        if (bp.href == url)
            this.scriptView.updateBreakpoint(bp);
    },

    onBreakpointModified: function(context, bp)
    {
        var url = this.getCurrentURL();
        if (bp.href == url)
            this.scriptView.updateBreakpoint(bp);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Options

    getOptionsMenuItems: function()
    {
        return [
            Menu.optionMenu("firebug.debugger.breakOnExceptions",
                "breakOnExceptions",
                "firebug.debugger.tip.breakOnExceptions"),
            Menu.optionMenu("firebug.debugger.ignoreCaughtExceptions",
                "ignoreCaughtExceptions",
                "firebug.debugger.tip.ignoreCaughtExceptions"),
            Menu.optionMenu("firebug.breakpoint.showBreakNotifications",
                "showBreakNotification",
                "firebug.breakpoint.tip.Show_Break_Notifications")
        ];
    },

    updateOption: function(name, value)
    {
        if (name == "breakOnExceptions" || name == "ignoreCaughtExceptions")
            this.tool.updateBreakOnErrors();
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Context Menu

    /**
     * The method handles 'onEditorContextMenu' fired by {@link ScriptView}.
     * xxxHonza: should be probably removed.
     */
    onEditorContextMenu: function(event, items)
    {
        var target = event.target;
        var menuItems = this.getContextMenuItems(null, target);
        items.push.apply(items, menuItems);
    },

    getContextMenuItems: function(object, target)
    {
        var info = this.scriptView.getContextMenuInfo();

        var items = [];

        // The target must be the textarea used by CodeMirror (thus we're sure that the right-click
        // targeted the code and not the breakpoints area). If the right-click targeted the
        // breakpoints area, we hide the context menu and show instead the condition editor.
        //
        // This could be changed if we decide to have a context menu displayed for
        // right-click on a breakpoint (in the column bar) instead of the condition-editor.
        // See issue 4378
        var isCodeTarget = (target.tagName === "TEXTAREA" &&
            Dom.getAncestorByClass(target, "CodeMirror"));

        Trace.sysout("scriptPanel.getContextMenuItems; isCodeTarget: " + isCodeTarget, target);

        if (!isCodeTarget)
            return;

        // The target provided by {@link FirebugChrome} is wrong, we need to use the
        // one from {@link SourceEditor}. See {@link SourceEditor.onInit} for more details.
        target = info.currentTarget;

        var lineNo = this.scriptView.getLineIndex(target);
        var text = this.scriptView.getSelectedText();
        if (text.toString())
        {
            items.push({
                label: "CopySourceCode",
                tooltiptext: "script.tip.Copy_Source_Code",
                command: Obj.bind(this.copySource, this)
            },
            "-",
            {
                label: "AddWatch",
                tooltiptext: "watch.tip.Add_Watch",
                acceltext: Locale.getFormattedKey(window, "alt", "W"),
                command: Obj.bind(this.addSelectionWatch, this)
            });
        }

        var hasBreakpoint = BreakpointStore.hasBreakpoint(this.getCurrentURL(), lineNo);
        items.push("-",
        {
            label: "SetBreakpoint",
            tooltiptext: "script.tip.Set_Breakpoint",
            type: "checkbox",
            checked: hasBreakpoint,
            command: Obj.bindFixed(this.toggleBreakpoint, this, lineNo)
        });

        if (hasBreakpoint)
        {
            var isDisabled = BreakpointStore.isBreakpointDisabled(this.getCurrentURL(), lineNo);
            items.push({
                label: "breakpoints.Disable_Breakpoint",
                tooltiptext: "breakpoints.tip.Disable_Breakpoint",
                type: "checkbox",
                checked: isDisabled,
                command: Obj.bindFixed(this.toggleDisableBreakpoint, this, lineNo)
            });
        }

        items.push({
            label: "EditBreakpointCondition",
            tooltiptext: "breakpoints.tip.Edit_Breakpoint_Condition",
            command: Obj.bindFixed(this.initializeEditBreakpointCondition, this, lineNo)
        });

        if (this.context.stopped)
        {
            var compilationUnit = this.getCompilationUnit();
            var debuggr = this;

            items.push(
                "-",
                // xxxHonza: TODO
                /*{
                    label: "script.Rerun",
                    tooltiptext: "script.tip.Rerun",
                    id: "contextMenuRerun",
                    command: Obj.bindFixed(debuggr.rerun, debuggr, this.context),
                    acceltext: "Shift+F8"
                },*/
                {
                    label: "script.Continue",
                    tooltiptext: "script.tip.Continue",
                    id: "contextMenuContinue",
                    command: Obj.bindFixed(debuggr.resume, debuggr, this.context),
                    acceltext: "F8"
                },
                {
                    label: "script.Step_Over",
                    tooltiptext: "script.tip.Step_Over",
                    id: "contextMenuStepOver",
                    command: Obj.bindFixed(debuggr.stepOver, debuggr, this.context),
                    acceltext: "F10"
                },
                {
                    label: "script.Step_Into",
                    tooltiptext: "script.tip.Step_Into",
                    id: "contextMenuStepInto",
                    command: Obj.bindFixed(debuggr.stepInto, debuggr, this.context),
                    acceltext: "F11"
                },
                {
                    label: "script.Step_Out",
                    tooltiptext: "script.tip.Step_Out",
                    id: "contextMenuStepOut",
                    command: Obj.bindFixed(debuggr.stepOut, debuggr, this.context),
                    acceltext: "Shift+F11"
                }/*,
                {
                    label: "firebug.RunUntil",
                    tooltiptext: "script.tip.Run_Until",
                    id: "contextMenuRunUntil",
                    command: Obj.bindFixed(debuggr.runUntil, debuggr, this.context,
                        compilationUnit, lineNo)
                }*/
            )
        }

        return items;
    },

    closePopupMenu: function()
    {
        var popupMenu = document.getElementById("fbScriptViewPopup");
        if (popupMenu.state === "open")
            popupMenu.hidePopup();
    },

    getPopupObject: function(target)
    {
        var isCodeTarget = (target.tagName === "TEXTAREA" &&
            Dom.getAncestorByClass(target, "CodeMirror"));

        if (!isCodeTarget)
            return Firebug.getRepObject(target);

        var info = this.scriptView.getContextMenuInfo();
        if (!info.rangeParent)
            return Firebug.getRepObject(target);

        var expr = this.getExpressionUnderCursor(info.x, info.y,
            info.rangeParent, info.rangeOffset);

        if (!expr)
            return Firebug.getRepObject(target);

        var evalResult;
        var success = (result, context) => { evalResult = result; }
        var failure = (result, context) => { }

        CommandLine.evaluate(expr, this.context, null,
            this.context.getCurrentGlobal(),
            success, failure, {noStateChange: true});

        // xxxHonza: a promise should be returned since CommandLine.evaluate might
        // be asynchronous in the future.
        return evalResult;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Context Menu Commands

    copySource: function()
    {
        var text = this.scriptView.getSelectedText();
        System.copyToClipboard(text);
    },

    addSelectionWatch: function()
    {
        var watchPanel = this.context.getPanel("watches", true);
        if (!watchPanel)
            return;

        var text = this.scriptView.getSelectedText();
        watchPanel.addWatch(text);
    },

    toggleBreakpoint: function(line)
    {
        Trace.sysout("scriptPanel.toggleBreakpoint; " + line);

        var hasBreakpoint = BreakpointStore.hasBreakpoint(this.getCurrentURL(), line);
        if (hasBreakpoint)
            BreakpointStore.removeBreakpoint(this.getCurrentURL(), line);
        else
            this.scriptView.initializeBreakpoint(line);
    },

    toggleDisableBreakpoint: function(line)
    {
        var currentUrl = this.getCurrentURL();

        var hasBreakpoint = BreakpointStore.hasBreakpoint(currentUrl, line);
        if (!hasBreakpoint)
        {
            // Create disabled breakpoint if it doesn't exist yet and bail out.
            BreakpointStore.addBreakpoint(currentUrl, line, undefined, undefined, true);
            return;
        }

        var isDisabled = BreakpointStore.isBreakpointDisabled(currentUrl, line);
        if (isDisabled)
            BreakpointStore.enableBreakpoint(currentUrl, line);
        else
            BreakpointStore.disableBreakpoint(currentUrl, line);
    },

    togglePrettyPrint: function()
    {
        Trace.sysout("scriptPanel.togglePrettyPrint;");

        var sourceFile = this.getSourceFile();
        sourceFile.togglePrettyPrint(() =>
        {
            //var lines = DebuggerLib.getExecutableLines(this.context, sourceFile);
            //Trace.sysout("lines " + lines.join(", "), lines);
        });
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // BON

    supportsBreakOnNext: function()
    {
        return this.breakable;
    },

    breakOnNext: function(enabled, callback)
    {
        BreakOnNext.breakOnNext(this.context, enabled, callback);
    },

    getBreakOnNextTooltip: function(armed)
    {
        return (armed ?
            Locale.$STR("script.Disable Break On Next") : Locale.$STR("script.Break On Next"));
    },

    shouldBreakOnNext: function()
    {
        return !!this.context.breakOnNextActivated;  // TODO BTI
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Toolbar functions

    attachListeners: function(context, chrome)
    {
        this.keyListeners =
        [
            chrome.keyCodeListen("F8", Events.isShift, Obj.bind(this.rerun, this, context), true),
            chrome.keyCodeListen("F8", null, Obj.bind(this.resume, this, context), true),
            chrome.keyCodeListen("F10", null, Obj.bind(this.stepOver, this, context), true),
            chrome.keyCodeListen("F11", null, Obj.bind(this.stepInto, this, context)),
            chrome.keyCodeListen("F11", Events.isShift, Obj.bind(this.stepOut, this, context))
        ];
    },

    detachListeners: function(context, chrome)
    {
        if (this.keyListeners)
        {
            for (var i = 0; i < this.keyListeners.length; ++i)
                chrome.keyIgnore(this.keyListeners[i]);
            delete this.keyListeners;
        }
    },

    // Update the pretty-print button to reflect ability of the selection to be reformatted
    setPrettyPrintState: function()
    {
        var sourceFile = this.getSourceFile();
        var category = sourceFile.getCategory();

        // Pretty printing can be done only for source files that have
        // corresponding server side script actor. Note that dynamic scripts
        // are currently collected on the client side (a workaround) since
        // RDP doesn't support it yet.
        var prettyPrintButton = Firebug.chrome.$("fbToggleScriptPrettyPrinting");
        prettyPrintButton.disabled = (category !== "js" || !sourceFile.actor);
        prettyPrintButton.checked = (!prettyPrintButton.disabled && sourceFile.isPrettyPrinted);
    },

    syncListeners: function(context)
    {
        var chrome = Firebug.chrome;

        if (context.stopped)
            this.attachListeners(context, chrome);
        else
            this.detachListeners(context, chrome);
    },

    syncCommands: function(context)
    {
        Trace.sysout("scriptPanel.syncCommands; stopped: " + context.stopped +
            ", " + context.getName());

        var chrome = Firebug.chrome;
        if (!chrome)
        {
            TraceError.sysout("scriptPanel.syncCommand, context with no chrome: " +
                context.getCurrentGlobal());

            return;
        }

        if (context.stopped)
        {
            chrome.setGlobalAttribute("fbDebuggerButtons", "stopped", "true");
            chrome.setGlobalAttribute("cmd_firebug_rerun", "disabled", "false");
            chrome.setGlobalAttribute("cmd_firebug_resumeExecution", "disabled", "false");
            chrome.setGlobalAttribute("cmd_firebug_stepOver", "disabled", "false");
            chrome.setGlobalAttribute("cmd_firebug_stepInto", "disabled", "false");
            chrome.setGlobalAttribute("cmd_firebug_stepOut", "disabled", "false");
        }
        else
        {
            chrome.setGlobalAttribute("fbDebuggerButtons", "stopped", "false");
            chrome.setGlobalAttribute("cmd_firebug_rerun", "disabled", "true");
            chrome.setGlobalAttribute("cmd_firebug_stepOver", "disabled", "true");
            chrome.setGlobalAttribute("cmd_firebug_stepInto", "disabled", "true");
            chrome.setGlobalAttribute("cmd_firebug_stepOut", "disabled", "true");
            chrome.setGlobalAttribute("cmd_firebug_resumeExecution", "disabled", "true");
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Toolbar functions

    rerun: function(context)
    {
        this.tool.rerun();
    },

    resume: function(context)
    {
        this.tool.resume();
    },

    stepOver: function(context)
    {
        this.tool.stepOver();
    },

    stepInto: function(context)
    {
        this.tool.stepInto();
    },

    stepOut: function(context)
    {
        this.tool.stepOut();
    },

    runUntil: function(context, compilationUnit, lineNo)
    {
        this.tool.runUntil(compilationUnit, lineNo);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    supportsObject: function(object, type)
    {
        if (object instanceof CompilationUnit
            || (object instanceof SourceLink && object.type == "js")
            || typeof(object) == "function"
            || object instanceof StackFrame)
        {
            // Higher priority than the DOM panel.
            return 2;
        }

        return 0;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // DebuggerTool Listener

    onStartDebugging: function(context, event, packet)
    {
        Trace.sysout("scriptPanel.onStartDebugging; " + this.context.getName());

        try
        {
            var currentBreakable = Firebug.chrome.getGlobalAttribute(
                "cmd_firebug_toggleBreakOn", "breakable");

            Trace.sysout("scriptPanel.onStartDebugging; currentBreakable " + currentBreakable +
                " in " + this.context.getName() + " currentContext " +
                Firebug.currentContext.getName());

            // If currentBreakable is false, then we are armed, but we broke
            if (currentBreakable == "false")
                Firebug.chrome.setGlobalAttribute("cmd_firebug_toggleBreakOn", "breakable", "true");

            // If Firebug is minimized, open the UI to show we are stopped
            if (Firebug.isMinimized())
                Firebug.unMinimize();

            this.syncCommands(this.context);
            this.syncListeners(this.context);

            // Handling focus events causes Firebug UI to freeze (see issue 7480),
            // so, release the focus from the browser window it'll be focused
            // again on the line below.
            Firebug.chrome.blur();

            // issue 3463 and 4213
            Firebug.chrome.syncPanel("script");
            Firebug.chrome.focus();

            // Make sure the debug location is updated (issue 7028)
            Firebug.chrome.select(this.context.currentFrame, "script");

            this.highlight(true);

            // Display break notification box.
            BreakNotification.show(this.context, this.panelNode, packet.why.type, this);
        }
        catch (exc)
        {
            TraceError.sysout("Resuming debugger: ERROR during debugging loop: " + exc, exc);
            Firebug.Console.log("Resuming debugger: ERROR during debugging loop: " + exc);

            this.resume(this.context);
        }
    },

    onStopDebugging: function(context)
    {
        Trace.sysout("scriptPanel.onStopDebugging; " + this.context.getName());

        try
        {
            var chrome = Firebug.chrome;

            this.selection = null;
            this.syncCommands(this.context);
            this.syncListeners(this.context);
            this.showNoStackFrame();

            // After main panel is completely updated
            chrome.syncSidePanels();

            this.highlight(false);

            // Make sure the break notification box is hidden when debugger resumes.
            BreakNotification.hide(this.context);
        }
        catch (exc)
        {
            TraceError.sysout("scriptPanel.onStopDebugging; EXCEPTION " + exc, exc);
        }
    },

    newSource: function(sourceFile)
    {
        // This event can be missed since the newSource packet can be send
        // before the ScriptPanel is initialized and adds itself to the DebuggerTool
        // as a listener.

        // New script has been appended, update the default location if necessary.
        // xxxHonza: Do not use this.navigate() method since it would fire "onPanelNavigate"
        // event and cause {@linke NavigationHistory} to be updated (issue 6950).
        // Also, explicit executing of syncLocationList here is not ideal (are there any
        // other options?)
        // Do the update location only if the panel is the selected one at the moment.
        if (!this.location && this.isSelected())
        {
            this.location = this.getDefaultLocation();

            Trace.sysout("scriptPanel.newSource; this.location.getURL() = " +
                (this.location ? this.location.getURL() : "no url"));

            this.updateLocation(this.location);
            Firebug.chrome.syncLocationList();
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Info Tips

    updateInfoTip: function()
    {
        var infoTip = this.panelBrowser ? this.panelBrowser.infoTip : null;
        if (infoTip && this.infoTipExpr)
            this.populateInfoTip(infoTip, this.infoTipExpr);
    },

    showInfoTip: function(infoTip, target, x, y, rangeParent, rangeOffset)
    {
        if (Css.hasClass(target, "breakpoint condition"))
            return this.populateBreakpointInfoTip(infoTip, target);

        // The source script must be within proper content.
        var viewContent = Dom.getAncestorByClass(target, "CodeMirror");
        if (!viewContent)
            return;

        var text = this.getExpressionUnderCursor(x, y, rangeParent, rangeOffset);
        if (!text)
            return false;

        if (text == this.infoTipExpr)
            return true;
        else
            return this.populateInfoTip(infoTip, text);
    },

    populateInfoTip: function(infoTip, expr)
    {
        if (!expr || Keywords.isJavaScriptKeyword(expr))
            return false;

        // Tooltips for variables in the script source are only displayed if the
        // script execution is halted (i.e. there is a current frame).
        var frame = this.context.currentFrame;
        if (!frame)
            return false;

        var self = this;

        function success(result, context)
        {
            var rep = Firebug.getRep(result, context);
            var tag = rep.shortTag ? rep.shortTag : rep.tag;

            tag.replace({object: result}, infoTip);

            self.infoTipExpr = expr;
        }

        function failure(result, context)
        {
            // We are mostly not interested in this evaluation error. It just pollutes
            // the tracing console.
            // Trace.sysout("scriptPanel.populateInfoTip; ERROR " + result, result);

            self.infoTipExpr = "";
        }

        // If the evaluate fails, then we report an error and don't show the infotip.
        CommandLine.evaluate(expr, this.context, null, this.context.getCurrentGlobal(),
            success, failure, {noStateChange: true});

        return (this.infoTipExpr == expr);
    },

    populateBreakpointInfoTip: function(infoTip, target)
    {
        var lineNo = this.scriptView.getLineIndex(target);
        var bp = BreakpointStore.findBreakpoint(this.getCurrentURL(), lineNo);
        if (!bp)
            return false;

        var expr = bp.condition;
        if (!expr)
            return false;

        if (expr == this.infoTipExpr)
            return true;

        BreakpointInfoTip.render(infoTip, expr);

        this.infoTipExpr = expr;

        return true;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    getExpressionUnderCursor: function(x, y, rangeParent, rangeOffset)
    {
        // First try to get selected expression under the cursor.
        var text = this.scriptView.getSelectedTextFrom(x, y);
        if (!text)
        {
            // See http://code.google.com/p/fbug/issues/detail?id=889
            // Idea from: Jonathan Zarate's rikaichan extension (http://www.polarcloud.com/rikaichan/)
            if (!rangeParent)
                return false;

            rangeOffset = rangeOffset || 0;
            var row = Dom.getAncestorByClass(rangeParent, "firebug-line");
            var expr = null;
            if (row)
            {
                var range = rangeParent.ownerDocument.createRange();
                range.setStart(row, 0);
                range.setEnd(rangeParent, rangeOffset);
                expr = getExpressionAt(range.startContainer.textContent, range.toString().length);
            }

            if (!expr || !expr.expr)
                return false;

            text = expr.expr;
        }

        return text;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Executable Lines

    onViewportChange: function(from, to)
    {
        // Run executable-line decorating on 150ms timeout, which is bigger than
        // the period in which scroll events are fired. So, if the user is moving
        // scroll-bar thumb (or quickly clicking on scroll-arrows), the line numbers
        // are not decorated and the scrolling is fast.
        // All this optimalization due to peformance penalities when computing exe lines.
        if (this.context.markExeLinesTimeout)
            this.context.clearTimeout(this.context.markExeLinesTimeout);

        this.context.markExeLinesTimeout = this.context.setTimeout(
            this.markExecutableLines.bind(this, from, to), 150);
    },

    markExecutableLines: function(from, to)
    {
        var self = this;
        var currentLine = from;
        var editor = this.scriptView.getInternalEditor().editorObject;

        Trace.sysout("scriptPanel.markExecutableLines; from: " + from + ", to: " + to);

        // Iterate over all visible lines.
        editor.eachLine(from, to, function(handle)
        {
            currentLine++;

            // Bail out if the exe-flag for this line has been already computed.
            // xxxHonza: don't bail out, some scripts could have been garbage collected,
            // and we need to make sure the executable status is properly updated.
            // See also issue 6948 (and included links to platform bugs).
            // xxxHonza: issue 6948 isn't yet closed and this code might change
            // as soon as the platform bugs are fixed.
            // xxxHonza: See {@link ScriptPanelLineUpdater} that is responsible for proper
            // status update (in case of garbage collected scripts). Fast scrolling needs
            // this optimization.
            if (typeof(handle.executableLine) != "undefined")
                return;

            // Check if the line is executable (performance expensive operation).
            handle.executableLine = DebuggerLib.isExecutableLine(self.context, {
                url: self.getCurrentURL(),
                line: currentLine,
            });

            // Update line executable style.
            if (handle.executableLine)
                editor.addLineClass(handle, "executable", "CodeMirror-executableLine");
            else
                editor.removeLineClass(handle, "executable", "CodeMirror-executableLine");
        });
    },
});

// ********************************************************************************************* //
// Breakpoint InfoTip Template

var BreakpointInfoTip = domplate(Rep,
{
    tag:
        DIV("$expr"),

    render: function(parentNode, expr)
    {
        this.tag.replace({expr: expr}, parentNode, this);
    }
});

// ********************************************************************************************* //

const reWord = /([A-Za-z_$0-9]+)(\.([A-Za-z_$0-9]+)|\[([A-Za-z_$0-9]+|["'].+?["'])\])*/;

function getExpressionAt(text, charOffset)
{
    var offset = 0;
    for (var m = reWord.exec(text); m; m = reWord.exec(text.substr(offset)))
    {
        var word = m[0];
        var wordOffset = offset+m.index;
        if (charOffset >= wordOffset && charOffset <= wordOffset+word.length)
        {
            var innerOffset = charOffset-wordOffset;
            m = word.substr(innerOffset+1).match(/\.|\]|\[|$/);
            var end = m.index + innerOffset + 1, start = 0;

            var openBr = word.lastIndexOf('[', innerOffset);
            var closeBr = word.lastIndexOf(']', innerOffset);

            if (openBr == innerOffset)
                end++;
            else if (closeBr < openBr)
            {
                if (/['"\d]/.test(word[openBr+1]))
                    end++;
                else
                    start = openBr + 1;
            }

            word = word.substring(start, end);

            if (/^\d+$/.test(word) && word[0] != '0')
                word = '';

            return {expr: word, offset: wordOffset-start};
        }
        offset = wordOffset+word.length;
    }

    return {expr: null, offset: -1};
};

// ********************************************************************************************* //
// Registration

Firebug.registerPanel(ScriptPanel);
Firebug.registerTracePrefix("scriptPanel.", "DBG_SCRIPTPANEL", false);

return ScriptPanel;

// ********************************************************************************************* //
});
