/* See license.txt for terms of usage */

define([
    "firebug/firebug",
    "firebug/lib/trace",
    "firebug/lib/object",
    "firebug/chrome/tool",
    "firebug/debugger/debuggerLib",
    "firebug/debugger/breakpoints/breakpointStore",
    "firebug/remoting/debuggerClient",
],
function (Firebug, FBTrace, Obj, Tool, DebuggerLib, BreakpointStore, DebuggerClient) {

"use strict";

// ********************************************************************************************* //
// Constants

var TraceError = FBTrace.toError();
var Trace = FBTrace.to("DBG_BREAKPOINTTOOL");

// ********************************************************************************************* //
// Breakpoint Tool

function BreakpointTool(context)
{
    this.context = context;
}

/**
 * @object BreakpointTool object is automatically instantiated by the framework for each
 * context. The object represents a proxy to the backend and all communication related
 * to breakpoints should be done through it.
 *
 * {@link BreakpointTool} (one instance per context) is also handling events coming from
 * {@link BreakpointStore} (one instance per Firebug), performs async operation with the
 * server side (using RDP) and forwards results to all registered listeners, which are
 * usually panel objects.
 */
BreakpointTool.prototype = Obj.extend(new Tool(),
/** @lends BreakpointTool */
{
    dispatchName: "breakpointTool",

    // xxxHonza: do we really need this? The underlying framework already has a queue
    // for 'setBreakpoint' packets.
    queue: new Array(),
    setBreakpointInProgress: false,

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Initialization

    onAttach: function(reload)
    {
        Trace.sysout("breakpointTool.attach; context ID: " + this.context.getId());

        // Listen for 'newScript' events.
        this.context.getTool("source").addListener(this);

        // Listen for {@link BreakpointStore} events to create/remove breakpoints
        // in the related backend (thread actor).
        BreakpointStore.addListener(this);
    },

    onDetach: function()
    {
        Trace.sysout("breakpointTool.detach; context ID: " + this.context.getId());

        this.context.getTool("source").removeListener(this);

        // Breakpoint clients (instance of native BreakpointClient object) are
        // preserved across page reloads through Panel's persistent state.
        // So, we can't just remove them here otherwise breakpoints would be re-created
        // and duplicated on the server side (at the same location)
        // (see also {@BreakpointTool.newSource} method) breakpoints with no client object
        // are set on the backend (see also issue 7290). See also issue 7295 that might be
        // related.
        // this.context.breakpointClients = [];

        // Breakpoints need to be disabled on the server side when detach happens
        // (see also issue 7295).
        // xxxHonza: this is a workaround for bug:
        // https://bugzilla.mozilla.org/show_bug.cgi?id=991688
        var threadActor = DebuggerLib.getThreadActor(this.context.browser);
        if (threadActor)
            threadActor.disableAllBreakpoints();

        BreakpointStore.removeListener(this);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // BreakpointStore Event Listener

    onAddBreakpoint: function(bp)
    {
        Trace.sysout("breakpointTool.onAddBreakpoint; (" + bp.lineNo + ")", bp);

        // Do not create server side actors for disabled breakpoints.
        if (bp.disabled)
        {
          this.dispatch("onBreakpointAdded", [this.context, bp]);
          Firebug.dispatchEvent(this.context.browser, "onBreakpointAdded", [bp]);
          return;
        }

        var self = this;
        this.setBreakpoint(bp.href, bp.lineNo, function(response, bpClient)
        {
            Trace.sysout("breakpointTool.onAddBreakpoint; callback executed", response);

            // Protocol change, URL is now stored in the source.
            // Make a copy to the expected location.
            if (!bpClient.location.url) {
              bpClient.location.url = bpClient.source._form.href;
            }

            // Do not log error if it's 'noScript'. It's quite common that breakpoints
            // are set before scripts exists (or no longer exists since garbage collected).
            if (response.error && response.error != "noScript")
            {
                TraceError.sysout("breakpointTool.onAddBreakpoint; ERROR: " +
                    response.message, response);
                return;
            }

            // Auto-correct shared breakpoint object if necessary and store the original
            // line so, listeners (like e.g. the Script panel) can update the UI.
            var correctedLine = bpClient.location.line - 1;
            if (bp.lineNo != correctedLine)
            {
                Trace.sysout("breakpointTool.onAddBreakpoint; line correction " +
                    bp.lineNo + " -> " + correctedLine);

                // The breakpoint line is going to be corrected, let's check if there isn't
                // an existing breakpoint at the new line. Note: This must be done before
                // the correction, since the value stored in the bp variable is by reference,
                // so that would be always found and marked as duplicated to be removed.
                var dupBp = BreakpointStore.findBreakpoint(bp.href, correctedLine);

                // bpClient deals with 1-based line numbers. Firebug uses 0-based
                // line numbers (indexes). Let's fix the line.
                bp.params.originLineNo = bp.lineNo;
                bp.lineNo = correctedLine;

                // If an existing breakpoint has been found we need to remove the newly
                // created one to avoid duplicities (two breakpoints at the same line).
                // Do not fire an event when removing, it's just client side thing.
                if (dupBp)
                {
                    BreakpointStore.removeBreakpointInternal(dupBp.href, dupBp.lineNo);
                    Trace.sysout("breakpointTool.onAddBreakpoint; remove new BP it's a dup");
                }
            }

            // Breakpoint is ready on the server side, let's notify all listeners so,
            // the UI is properly (and asynchronously) updated everywhere.
            self.dispatch("onBreakpointAdded", [self.context, bp]);

            // Adding breakpoints is asynchronous, it might happen that the
            // context (and browser) is closed soon than the async process
            // finishes, so avoid exception.
            // It would be better to avoid such scenarios.
            if (self.context.browser)
                Firebug.dispatchEvent(self.context.browser, "onBreakpointAdded", [bp]);

            // The info about the original line should not be needed any more.
            delete bp.params.originLineNo;
        });
    },

    onRemoveBreakpoint: function(bp)
    {
        this.removeBreakpoint(bp.href, bp.lineNo, (response) =>
        {
            this.dispatch("onBreakpointRemoved", [this.context, bp]);

            Firebug.dispatchEvent(this.context.browser, "onBreakpointRemoved", [bp]);
        });
    },

    onEnableBreakpoint: function(bp)
    {
        this.enableBreakpoint(bp.href, bp.lineNo, (response, bpClient) =>
        {
            this.dispatch("onBreakpointEnabled", [this.context, bp]);
        });
    },

    onDisableBreakpoint: function(bp)
    {
        this.disableBreakpoint(bp.href, bp.lineNo, (response, bpClient) =>
        {
            this.dispatch("onBreakpointDisabled", [this.context, bp]);
        });
    },

    onModifyBreakpoint: function(bp)
    {
        this.dispatch("onBreakpointModified", [this.context, bp]);
    },

    onModifyCondition: function(bp)
    {
        var client = this.getBreakpointClient(bp.href, bp.lineNo);

        if (!client)
        {
            TraceError.sysout("breakpointTool.onModifyCondition; ERROR no client!");
            return;
        }

        var condition = bp.condition || "";

        Trace.sysout("breakpointTool.onModifyCondition; set bp condition: " +
            condition, bp);

        // xxxHonza: BreakpointClient.setCondition() has been introduced in
        // Firefox 31 [Fx31], and so use internal implementation cloned from
        // Firefox 32 in that case.
        var set;
        if (client.setCondition)
            set = client.setCondition.bind(client, this.context.activeThread, bp.condition);
        else
            set = setCondition.bind(this, this.context, client, bp.condition);

        set().then((newBpClient) =>
        {
            Trace.sysout("breakpointTool.onModifyCondition; Done", newBpClient);

            this.removeBreakpointClient(bp.href, bp.lineNo);
            this.context.breakpointClients.push(newBpClient);

            this.dispatch("onBreakpointModified", [this.context, bp]);
        });
    },

    onRemoveAllBreakpoints: function(bps)
    {
        Trace.sysout("breakpointTool.onRemoveAllBreakpoints; (" + bps.length + ")", bps);

        var deferred = this.context.defer();

        this.removeBreakpoints(bps, () =>
        {
            deferred.resolve();
        });

        return deferred.promise;
    },
    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // SourceTool

    newSource: function(sourceFile)
    {
        // Get all breakpoints (not including dynamic breakpoints) that belong to the
        // newly created source.
        var url = sourceFile.getURL();
        var bps = BreakpointStore.getBreakpoints(url/*, true*/);

        // Filter out those breakpoints that have been already set on the backend
        // (i.e. there is a corresponding client object already).
        var filtered = bps.filter((bp) =>
        {
            // xxxHonza: Do not try to create server side breakpoint actors for
            // dynamic breakpoints. This is an optimization, it would fail anyway.
            // We should avoid leaking dynamic-script related code from
            // firebug/debugger/script/sourceTool module, let's fix this later.
            if (bp.params.dynamicHandler)
                return;

            return !this.getBreakpointClient(bp.href, bp.lineNo);
        });

        // Bail out if there is nothing to set.
        if (!filtered.length)
        {
            Trace.sysout("breakpointTool.newSource; No breakpoints to set for: " + url, bps);
            return;
        }

        // Filter out disabled breakpoints. These won't be set on the server side
        // (unless the user enables them later).
        // xxxHonza: we shouldn't create server-side breakpoints for normal disabled
        // breakpoints, but not in case there are other breakpoints at the same line.
        /*filtered = filtered.filter(function(bp, index, array)
        {
            return bp.isEnabled();
        });*/

        Trace.sysout("breakpointTool.newSource; Initialize server side breakpoints: (" +
            filtered.length + ") " + url, filtered);

        // Set breakpoints on the server side.
        this.setBreakpoints(filtered, function()
        {
            // Some breakpoints could have been auto-corrected so, save all now.
            // xxxHonza: what about breakpoints in other contexts using the same URL?
            // Should they be corrected too?

            // xxxHonza: fix me
            // If the thread is paused the callback is called too soon (before all
            // breakpoints are set on the server and response packets received).
            //BreakpointStore.save(url);

            Trace.sysout("breakpointTool.newSource; breakpoints initialized " + url, arguments);
        });
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Breakpoint Backend API

    /**
     * Setting a breakpoint is an asynchronous process that requires communication with
     * the backend. There can be three round-trips with the server:
     * 1) SEND 'interrupt' -> RECEIVED 'paused'
     * 2) SEND 'setBreakpoint' -> RECEIVED 'actor'
     * 3) SEND 'resume' -> RECEIVED 'resumed'
     *
     * If the method is called again in the middle of an existing set-breakpoint-sequence,
     * arguments are pushed in a |queue| and handled after the first process finishes.
     *
     * xxxHonza: the thread doesn't have to be interrupted/resumed if there are
     * other breakpoints waiting in the queue.
     */
    setBreakpoint: function(url, lineNumber, callback)
    {
        // The context needs to be attached to the thread in order to set a breakpoint.
        var thread = this.context.activeThread;
        if (!thread)
        {
            TraceError.sysout("BreakpointTool.setBreakpoint; ERROR Can't set BP, no thread.");
            return;
        }

        if (Trace.active)
        {
            Trace.sysout("breakpointTool.setBreakpoint; " + url + " (" + lineNumber + ") " +
                "thread client state: " + thread.state);

            // xxxHonza: I have experienced a problem where the client side state
            // was set to "paused", but the server side still failed to set a breakpoint
            // due to debugger not being in pause state.
            var threadActor = DebuggerLib.getThreadActor(this.context.browser);
            Trace.sysout("breakpointTool.setBreakpoint; thread actor state: " +
                threadActor.state + ", client state: " + thread.state);

            // xxxHonza: I can't set a breakpoint sometimes because ThreadClient
            // (context.activeThread) says state == paused, while the ThreadActor
            // is *not* paused. This causes an exception on the server side.
            if (thread.state == "paused" && threadActor.state != "paused")
            {
                // Let's see if anyone can find STR
                FBTrace.sysout("breakpointTool.setBreakpoint; ERROR Client thread " +
                    "is out of sync. Let me know how to reproduce this! Honza");
            }
        }

        // Do not create two server side breakpoints at the same line.
        var bpClient = this.getBreakpointClient(url, lineNumber);
        if (bpClient)
        {
            Trace.sysout("breakpointTool.onAddBreakpoint; BP client already exists", bpClient);

            //xxxHonza: the callback expects a packet, it should not.
            if (callback)
                callback({}, bpClient);
            return;
        }

        var self = this;

        function doSetBreakpoint(callback)
        {
            var bp = BreakpointStore.findBreakpoint(url, lineNumber);

            var location = {
                url: url,
                line: lineNumber + 1,
                condition: bp ? bp.condition : null,
            };

            Trace.sysout("breakpointTool.doSetBreakpoint; (" + lineNumber + ")", location);

            if (!self.context.activeThread)
            {
                TraceError.sysout("breakpointTool.doSetBreakpoint; ERROR no thread " +
                    url + "(" + lineNumber + ")");
                return;
            }

            // Send RDP packet to set a breakpoint on the server side. The callback will be
            // executed as soon as we receive a response.
            if (!isNormalDisabledBreakpoint(bp))
            {
                // The protocol changed in Firefox 36. Setting a breakpoint
                // is now done through source actor not thread actor.
                // See also:
                // https://bugzilla.mozilla.org/show_bug.cgi?id=1105493
                // https://code.google.com/p/fbug/issues/detail?id=7724
                var setBreakpoint = self.context.activeThread.setBreakpoint;
                if (typeof setBreakpoint == "function")
                {
                    self.context.activeThread.setBreakpoint(location,
                        self.onSetBreakpoint.bind(self, callback));
                }
                else
                {
                    var sourceFile = self.context.getSourceFile(url);
                    if (sourceFile)
                    {
                        let sourceClient = sourceFile.getClient();
                        sourceClient.setBreakpoint(location, self.onSetBreakpoint.bind(self, callback));
                    }
                }
            }
        }

        // If the previous async-process hasn't finished yet, put arguments in a queue.
        if (this.setBreakpointInProgress)
        {
            Trace.sysout("breakpointTool.setBreakpoint; Setting BP in progress, wait " +
                 url + " (" + lineNumber + ")");

            this.queue.push(arguments);
            return;
        }

        this.setBreakpointInProgress = true;

        // If the debuggee is paused, just set the breakpoint.
        if (thread.paused)
        {
            doSetBreakpoint(function(response, bpClient)
            {
                self.setBreakpointInProgress = false;

                callback(response, bpClient);

                // Set breakpoints waiting in the queue.
                if (self.queue.length > 0)
                    self.setBreakpoint.apply(self, self.queue.shift());
            });
            return;
        }

        // Otherwise, force a pause in order to set the breakpoint.
        // xxxHonza: this sometimes generates 'alreadyPaused' packet, fix me.
        // Or maybe the interrupt call in setBreakpoints. You need a page with two
        // loaded URLs with breakpoints
        thread.interrupt(function(response)
        {
            if (response.error)
            {
                // Can't set the breakpoint if pausing failed.
                callback(response);
                return;
            }

            // Set the breakpoint
            doSetBreakpoint(function(response, bpClient)
            {
                // Wait for resume
                thread.resume(function(response)
                {
                    self.setBreakpointInProgress = false;

                    callback(response, bpClient);

                    // Set breakpoints waiting in the queue.
                    if (self.queue.length > 0)
                        self.setBreakpoint.apply(self, self.queue.shift());
                });
            });
        });
    },

    /**
     * Executed when a breakpoint is set on the backend and confirmation packet
     * has been received.
     */
    onSetBreakpoint: function(callback, response, bpClient)
    {
        var actualLocation = response.actualLocation;

        Trace.sysout("breakpointTool.onSetBreakpoint; " + bpClient.location.url + " (" +
            bpClient.location.line + ")", bpClient);

        // Note that both actualLocation and bpClient.location deal with 1-based
        // line numbers.
        if (actualLocation && actualLocation.line != bpClient.location.line)
        {
            // To be found when it needs removing.
            bpClient.location.line = actualLocation.line;
        }

        // Store breakpoint clients so, we can use the actors to remove breakpoints.
        // xxxFarshid: Shouldn't we save bpClient object only if there is no error?
        // xxxHonza: yes, we probably should.
        // xxxHonza: we also need an error logging
        if (!this.context.breakpointClients)
            this.context.breakpointClients = [];

        // Check if the breakpoint-client object already exist. The line could
        // have been corrected on the server side and there can already be a breakpoint
        // on the new line.
        if (bpClient.actor && !this.breakpointActorExists(bpClient))
            this.context.breakpointClients.push(bpClient);

        if (callback)
            callback(response, bpClient);

        this.setBreakpointInProgress = false;
    },

    /**
     * Creates breakpoint actors on the server side and {@link BreakpointClient} objects
     * on the client side. The client objects are stored within {@link TabContext}.
     *
     * @param arr {Array} List of breakpoints to be created on the server side
     * @param cb {Function} Optional callback that is executed as soon as all breakpoints
     * are created on the server side and the current thread resumed again.
     *
     * xxxHonza: Use a better name for the |cb| argument, ideally |callback| (and refactor
     * method implementation, so there isn't the other callback variable).
     */
    setBreakpoints: function(arr, cb)
    {
        var self = this;

        // Bail out if there is nothing to set.
        if (!arr.length)
            return;

        var thread = this.context.activeThread;
        if (!thread)
        {
            TraceError.sysout("BreakpointTool.setBreakpoints; Can't set breakpoints " +
                "if there is no active thread");
            return;
        }

        Trace.sysout("breakpointTool.setBreakpoints; " + arr.length +
            ", thread state: " + thread.state, arr);

        var doSetBreakpoints = function _doSetBreakpoints(callback)
        {
            Trace.sysout("breakpointTool.doSetBreakpoints; ", arr);

            // Iterate all breakpoints in the given array and set them step by step.
            // The following loop resumes/interrupts the thread for every bp set.
            // This should be optimized by using Promises (callbacks make this
            // a lot more complicated).
            for (var i = 0; i < arr.length; i++)
                self.onAddBreakpoint(arr[i]);

            if (callback)
                callback();
        };

        // If the thread is currently paused, go to set all the breakpoints.
        if (thread.paused)
        {
            // xxxHonza: the callback should be called when the last breakpoint
            // is set on the backend, fix me.
            doSetBreakpoints(cb);
            return;
        }

        // ... otherwise we need to interrupt the thread first.
        // It can happens that the debugger will pause before the "interrupt" packet
        // is processed by the server side. In such case the packet passed into the
        // following callback wouldn't be "interrupted", but different type (e.g. "paused")
        // So, do not resume if this happens (see the condition within the callback).
        // You can also observe this by seeing:
        // debuggerTool.paused; ERROR no frame, type: alreadyPaused
        // xxxHonza: this should solve most of the cases, but still, what if the other
        // component also calls interrupt?
        thread.interrupt(function(packet)
        {
            if (packet.error)
            {
                TraceError.sysout("BreakpointTool.setBreakpoints; Can't set breakpoints: " +
                    packet.error);
                return;
            }

            // When the thread is interrupted, we can set all the breakpoints.
            doSetBreakpoints(function()
            {
                Trace.sysout("breakpointTool.doSetBreakpoints; done", arguments);

                if (packet.why.type == "alreadyPaused")
                {
                    // If interrupt happened at the moment when the thread has already been
                    // paused, after we checked |thread.paused| (e.g. breakpoints in onload scripts),
                    // do not resume. See also issue 7118
                    if (cb)
                        cb();
                }
                else if (packet.why.type != "interrupted")
                {
                    // In this case, do not resume since the debugger wasn't interrupted
                    // by this method. It could have been e.g. a breakpoint hit and we
                    // do want to keep the debugger paused.
                    if (cb)
                        cb();
                }
                else
                {
                    // At this point, all 'setBreakpoint' packets have been generated (the first
                    // on already sent) and they are waiting in a queue. The resume packet will
                    // be received as soon as the last response for 'setBreakpoint' is received.
                    self.context.getTool("debugger").resume(cb);
                }
            });
        });
    },

    removeBreakpoint: function(url, lineNumber, callback)
    {
        Trace.sysout("breakpointTool.removeBreakpoint; " + url + " (" + lineNumber + ")");

        if (!this.context.activeThread)
        {
            TraceError.sysout("breakpointTool.removeBreakpoint; Can't remove breakpoints.");
            return;
        }

        // Do note remove server-side breakpoint if there are still some client side
        // breakpoint at the line.
        if (BreakpointStore.hasAnyBreakpoint(url, lineNumber))
        {
            // A disabled breakpoint remains in the breakpoint store but has to be removed
            // server-side. Also check that we only remove normal breakpoints, and not mix-typed
            // ones, because we would still need them server-side (such as monitor breakpoints).
            var bp = BreakpointStore.findBreakpoint(url, lineNumber);
            if (!isNormalDisabledBreakpoint(bp))
            {
                Trace.sysout("breakpointTool.removeBreakpoint; Can't remove BP it's still " +
                    "in the store! " + url + " (" + lineNumber + ")");

                // xxxHonza: the callback expects a packet as an argument, it should not.
                if (callback)
                    callback({});
                return;
            }
        }

        // We need to get the breakpoint client object for this context. The client
        // knows how to remove the breakpoint on the server side.
        var client = this.removeBreakpointClient(url, lineNumber);
        Trace.sysout("breakpointTool.removeBreakpoint; client: " + client, client);

        if (client)
        {
            client.remove(callback);
        }
        else
        {
            // xxxHonza: Don't display the error message. It can happen
            // that dynamic breakpoint (a breakpoint in dynamically created script)
            // is being removed. Such breakpoint doesn't have corresponding
            // {@link BreakpointClient} for now.
            //
            //TraceError.sysout("breakpointTool.removeBreakpoint; ERROR removing " +
            //    "non existing breakpoint. " + url + ", " + lineNumber);

            // Execute the callback in any case, so the UI can be updated.
            // xxxHonza: the callback expects a packet as an argument, it should not.
            if (callback)
                callback({});
        }
    },

    /**
     * Removes specified breakpoints. The removal is done asynchronously breakpoint
     * by breakpoint. The next breakpoint is removed as soon as there is a confirmation
     * from the backend that the previous one has been removed.
     *
     * @param {Array} bps Array of breakpoints to be removed. Every item in the array
     * should specify breakpoint location [{href: "", lineNo: 0}]
     * @param {Function} callback A function executed as soon as all breakpoints are removed.
     * The removal happens asynchronously since it requires communication with the backend
     * over RDP.
     */
    removeBreakpoints: function(bps, callback)
    {
        if (bps.length == 0)
        {
            if (callback)
                callback();
            return;
        }

        var bp = bps[0];
        this.removeBreakpoint(bp.href, bp.lineNo, (response) =>
        {
            if (response.error)
            {
                TraceError.sysout("breakpointTool.removeBreakpoints; ERROR " +
                    response.message, response);
            }

            this.removeBreakpoints(bps.slice(1), callback);
        });
    },

    getBreakpointClient: function(url, lineNumber)
    {
        var clients = this.context.breakpointClients;
        if (!clients)
            return;

        for (var i=0; i<clients.length; i++)
        {
            var client = clients[i];
            var loc = client.location;
            if (loc.url == url && (loc.line - 1) == lineNumber)
                return client;
        }
    },

    removeBreakpointClient: function(url, lineNumber)
    {
        var clients = this.context.breakpointClients;
        if (!clients)
            return;

        for (var i=0; i<clients.length; i++)
        {
            var client = clients[i];
            var loc = client.location;
            if (loc.url == url && (loc.line - 1) == lineNumber)
            {
                clients.splice(i, 1);
                return client;
            }
        }
    },

    breakpointActorExists: function(bpClient)
    {
        var clients = this.context.breakpointClients;
        if (!clients)
            return false;

        var client;
        for (var i=0, len = clients.length; i < len; i++)
        {
            client = clients[i];
            if (client.actor === bpClient.actor)
                return true;
        }

        return false;
    },

    enableBreakpoint: function(url, lineNumber, callback)
    {
        // Enable breakpoint means adding it to the server side.
        this.setBreakpoint(url, lineNumber, callback);
    },

    disableBreakpoint: function(url, lineNumber, callback)
    {
        // Disable breakpoint means removing it from the server side.
        this.removeBreakpoint(url, lineNumber, callback);
    },

    isBreakpointDisabled: function(url, lineNumber)
    {
        //return JSDebugger.fbs.isBreakpointDisabled(url, lineNumber);
    },

    getBreakpointCondition: function(url, lineNumber)
    {
        //return JSDebugger.fbs.getBreakpointCondition(url, lineNumber);
    },
});

// ********************************************************************************************* //
// Set Condition

/**
 * Set the condition of this breakpoint.
 * xxxHonza: cloned from dbg-client.jsm and modifed [Fx32].
 */
function setCondition(context, bpClient, condition)
{
    var threadClient = context.activeThread;
    var root = bpClient._client.mainRoot;
    var deferred = context.defer();

    if (root.traits.conditionalBreakpoints)
    {
        var info = {
            url: bpClient.location.url,
            line: bpClient.location.line,
            column: bpClient.location.column,
            condition: condition
        };

        // Remove the current breakpoint and add a new one with the condition.
        bpClient.remove((response) =>
        {
            if (response && response.error)
            {
                deferred.reject(response);
                return;
            }

            threadClient.setBreakpoint(info, (response, newBreakpoint) =>
            {
                if (response && response.error)
                    deferred.reject(response);
                else
                    deferred.resolve(newBreakpoint);
            });
        });
    }
    else
    {
        // The property shouldn't even exist if the condition is blank
        if (condition === "")
            delete bpClient.conditionalExpression;
        else
            bpClient.conditionalExpression = condition;

        deferred.resolve(bpClient);
    }

    return deferred.promise;
}

// ********************************************************************************************* //
// Helpers

/**
 * Returns true if the breakpoint is disabled and is exclusively a BP_NORMAL one.
 * @param {Breakpoint} bp The Breakpoint as defined in debugger/breakpoints/breakpoint.js
 *
 * @return {boolean}
 */
function isNormalDisabledBreakpoint(bp)
{
    return (bp && bp.disabled && bp.type === BreakpointStore.BP_NORMAL);
}

// ********************************************************************************************* //
// Registration

Firebug.registerTool("breakpoint", BreakpointTool);

return BreakpointTool;

// ********************************************************************************************* //
});
