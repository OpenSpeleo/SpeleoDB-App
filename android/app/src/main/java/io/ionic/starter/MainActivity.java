package org.speleodb.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local Android-only plugin used to request POST_NOTIFICATIONS (Android 13+)
        // for the background GPS recording foreground-service notification.
        registerPlugin(RecordingNotificationPermissionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
