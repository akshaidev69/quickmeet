package com.letsconnect.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.ref.WeakReference;

/**
 * Keeps the meeting alive in Android Picture-in-Picture when the user leaves
 * the full-screen activity (Home / app switch / after screen share starts).
 */
@CapacitorPlugin(name = "MeetingChrome")
public class MeetingChromePlugin extends Plugin {
    public static final String PIP_ACTION = "com.letsconnect.app.PIP_CONTROL";
    public static final String EXTRA_ACT = "act";

    private static WeakReference<MeetingChromePlugin> instance;
    private BroadcastReceiver receiver;

    public static MeetingChromePlugin getInstance() {
        return instance != null ? instance.get() : null;
    }

    @Override
    public void load() {
        instance = new WeakReference<>(this);
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String act = intent != null ? intent.getStringExtra(EXTRA_ACT) : null;
                if (act == null || act.isEmpty()) return;
                JSObject data = new JSObject();
                data.put("act", act);
                notifyListeners("pipAction", data);
            }
        };
        IntentFilter filter = new IntentFilter(PIP_ACTION);
        if (Build.VERSION.SDK_INT >= 33) {
            getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (Exception ignored) {
                /* already gone */
            }
            receiver = null;
        }
        if (instance != null && instance.get() == this) {
            instance = null;
        }
        super.handleOnDestroy();
    }

    public void emitPipMode(boolean inPip) {
        JSObject data = new JSObject();
        data.put("inPip", inPip);
        notifyListeners("pipMode", data);
    }

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
    public void setControls(PluginCall call) {
        boolean micOn = Boolean.TRUE.equals(call.getBoolean("micOn", true));
        boolean camOn = Boolean.TRUE.equals(call.getBoolean("camOn", true));
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).setPipControls(micOn, camOn);
        }
        call.resolve();
    }

    @PluginMethod
    public void setSuppressPip(PluginCall call) {
        boolean suppress = Boolean.TRUE.equals(call.getBoolean("suppress", false));
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).setSuppressPip(suppress);
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
