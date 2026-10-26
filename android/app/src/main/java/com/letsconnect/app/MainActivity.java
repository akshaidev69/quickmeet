package com.letsconnect.app;

import android.Manifest;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;

import com.capacitorjs.plugins.app.AppPlugin;
import com.capacitorjs.plugins.browser.BrowserPlugin;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    private static final int MEDIA_PERMISSION_REQUEST = 2401;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register before BridgeActivity wires the WebView bridge.
        registerPlugin(BrowserPlugin.class);
        registerPlugin(AppPlugin.class);
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

    private void requestMeetingPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        ActivityCompat.requestPermissions(
            this,
            new String[] {
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.MODIFY_AUDIO_SETTINGS
            },
            MEDIA_PERMISSION_REQUEST
        );
    }
}
