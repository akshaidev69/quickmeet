package com.letsconnect.app;

import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the meeting alive in Android Picture-in-Picture when the user leaves
 * the full-screen activity (Home / app switch / after screen share starts).
 */
@CapacitorPlugin(name = "MeetingChrome")
public class MeetingChromePlugin extends Plugin {

    @PluginMethod
    public void setMeetingActive(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).setMeetingActive(active);
        }
        call.resolve();
    }

    @PluginMethod
    public void enterPip(PluginCall call) {
        boolean entered = false;
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            entered = ((MainActivity) activity).enterPip();
        }
        JSObject result = new JSObject();
        result.put("entered", entered);
        call.resolve(result);
    }

    @PluginMethod
    public void isInPip(PluginCall call) {
        boolean inPip = false;
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            inPip = ((MainActivity) activity).isInPipMode();
        }
        JSObject result = new JSObject();
        result.put("inPip", inPip);
        call.resolve(result);
    }
}
