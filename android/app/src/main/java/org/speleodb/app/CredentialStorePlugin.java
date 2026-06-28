package org.speleodb.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;
import org.speleodb.app.security.AndroidCredentialStore;
import org.speleodb.app.security.CredentialStore;

@CapacitorPlugin(name = "CredentialStore")
public final class CredentialStorePlugin extends Plugin {
    private static final String ERROR_CODE = "E_CREDENTIAL_STORE";
    private CredentialStore credentialStore;

    @Override
    public void load() {
        credentialStore = AndroidCredentialStore.create(getContext());
    }

    @PluginMethod
    public void readToken(PluginCall call) {
        try {
            String token = credentialStore.readToken();
            JSObject result = new JSObject();
            result.put("token", token == null ? JSONObject.NULL : token);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Secure credential storage is unavailable", ERROR_CODE);
        }
    }

    @PluginMethod
    public void writeToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null) {
            call.reject("A valid authentication token is required", ERROR_CODE);
            return;
        }
        try {
            credentialStore.writeToken(token);
            call.resolve();
        } catch (Exception error) {
            call.reject("Secure credential storage is unavailable", ERROR_CODE);
        }
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        try {
            credentialStore.clearToken();
            call.resolve();
        } catch (Exception error) {
            call.reject("Secure credential storage is unavailable", ERROR_CODE);
        }
    }
}
