package com.letsconnect.app;

import android.Manifest;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;

import com.capacitorjs.plugins.app.AppPlugin;
import com.capacitorjs.plugins.browser.BrowserPlugin;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import java.util.ArrayList;

public class MainActivity extends BridgeActivity {
    private static final int MEDIA_PERMISSION_REQUEST = 2401;

    private boolean meetingActive = false;
    private boolean suppressPip = false;
    private boolean pipMicOn = true;
    private boolean pipCamOn = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register before BridgeActivity wires the WebView bridge.
        registerPlugin(BrowserPlugin.class);
        registerPlugin(AppPlugin.class);
        registerPlugin(ScreenSharePlugin.class);
        registerPlugin(MeetingChromePlugin.class);
        super.onCreate(savedInstanceState);
        requestMeetingPermissions();
    }

    @Override
    public void onStart() {
        super.onStart();
        if (this.bridge == null || this.bridge.getWebView() == null) return;

        WebView webView = this.bridge.getWebView();
        WebSettings settings = webView.getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);

        // Stop Android Autofill / password manager from hijacking auth fields.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        }

        webView.setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Grant camera, mic, and screen-capture resources for WebRTC / getDisplayMedia.
                MainActivity.this.runOnUiThread(() -> {
                    try {
                        request.grant(request.getResources());
                    } catch (Exception ignored) {
                        request.deny();
                    }
                });
            }
        });
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep the meeting WebView painting while minimized in PiP.
        if (isInPipMode() && this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        applyPipParams();
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().onResume();
            this.bridge.getWebView().resumeTimers();
        }
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (meetingActive && !suppressPip) {
            enterPip();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        }
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        WebView webView = this.bridge.getWebView();
        webView.setVisibility(View.VISIBLE);
        if (isInPictureInPictureMode) {
            webView.onResume();
            webView.resumeTimers();
        }
        MeetingChromePlugin plugin = MeetingChromePlugin.getInstance();
        if (plugin != null) {
            plugin.emitPipMode(isInPictureInPictureMode);
        }
    }

    public void setMeetingActive(boolean active) {
        meetingActive = active;
        if (!active) {
            suppressPip = false;
        }
        applyPipParams();
    }

    public void setSuppressPip(boolean suppress) {
        suppressPip = suppress;
        applyPipParams();
    }

    public void setPipControls(boolean micOn, boolean camOn) {
        pipMicOn = micOn;
        pipCamOn = camOn;
        applyPipParams();
    }

    public boolean isInPipMode() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode();
    }

    public boolean enterPip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        if (isInPictureInPictureMode()) return true;
        if (!meetingActive || suppressPip) return false;
        try {
            return enterPictureInPictureMode(pipParams());
        } catch (Exception ignored) {
            return false;
        }
    }

    private PictureInPictureParams pipParams() {
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
            .setAspectRatio(new Rational(9, 16));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setActions(pipActions());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(meetingActive && !suppressPip);
            builder.setSeamlessResizeEnabled(true);
        }
        return builder.build();
    }

    private ArrayList<RemoteAction> pipActions() {
        ArrayList<RemoteAction> actions = new ArrayList<>();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return actions;
        actions.add(remoteAction("mic", pipMicOn ? "Mute" : "Unmute", android.R.drawable.ic_btn_speak_now, 11));
        actions.add(remoteAction("cam", pipCamOn ? "Camera off" : "Camera on", android.R.drawable.ic_menu_camera, 12));
        actions.add(remoteAction("leave", "Leave", android.R.drawable.ic_menu_close_clear_cancel, 13));
        return actions;
    }

    private RemoteAction remoteAction(String act, String title, int icon, int requestCode) {
        Intent intent = new Intent(MeetingChromePlugin.PIP_ACTION);
        intent.setPackage(getPackageName());
        intent.putExtra(MeetingChromePlugin.EXTRA_ACT, act);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pending = PendingIntent.getBroadcast(this, requestCode, intent, flags);
        return new RemoteAction(Icon.createWithResource(this, icon), title, title, pending);
    }

    private void applyPipParams() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            setPictureInPictureParams(pipParams());
        } catch (Exception ignored) {
            /* PiP params not available yet */
        }
    }

    private void requestMeetingPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        java.util.ArrayList<String> needed = new java.util.ArrayList<>();
        needed.add(Manifest.permission.CAMERA);
        needed.add(Manifest.permission.RECORD_AUDIO);
        needed.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);
        if (Build.VERSION.SDK_INT >= 33) {
            needed.add(Manifest.permission.READ_MEDIA_IMAGES);
        } else {
            needed.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), MEDIA_PERMISSION_REQUEST);
    }
}
