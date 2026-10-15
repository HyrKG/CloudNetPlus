/*
 * Copyright 2019-2021 CloudNetService team & contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package de.dytanic.cloudnet.http;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.auth0.jwt.interfaces.JWTVerifier;
import com.google.common.base.Preconditions;
import de.dytanic.cloudnet.CloudNet;
import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.network.http.HttpCookie;
import de.dytanic.cloudnet.driver.network.http.IHttpContext;
import de.dytanic.cloudnet.driver.permission.IPermissionUser;
import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

public final class V1HttpSession {

  private static final Pattern BASE64_PATTERN = Pattern
    .compile("^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$");
  private static final String COOKIE_NAME = "CloudNet-REST_V1-Session";
  private static final String ISSUER = "CloudNet-REST-v1";
  private static final Path SIGNING_KEY_FILE = Paths.get("local/http-session.json");

  private static final long EXPIRE_SECONDS = TimeUnit.DAYS.toSeconds(30);

  private final Algorithm algorithm;
  private final JWTVerifier verifier;

  public V1HttpSession() {
    this.algorithm = Algorithm.HMAC256(this.loadSigningKey());
    this.verifier = JWT.require(this.algorithm)
      .withIssuer(ISSUER)
      .withClaimPresence("sub")
      .withClaimPresence("iat")
      .withClaimPresence("exp")
      .build();
  }

  public boolean auth(IHttpContext context) throws Exception {
    if (this.isAuthorized(context)) {
      this.logout(context);
    }

    if (!context.request().hasHeader("Authorization")) {
      return false;
    }

    String[] typeAndCredentials = context.request().header("Authorization").split(" ");

    if (typeAndCredentials.length != 2 || !typeAndCredentials[0].equalsIgnoreCase("Basic")) {
      return false;
    }

    if (!BASE64_PATTERN.matcher(typeAndCredentials[1]).matches()) {
      return false;
    }

    String[] credentials = new String(Base64.getDecoder().decode(typeAndCredentials[1]), StandardCharsets.UTF_8)
      .split(":");
    if (credentials.length != 2) {
      return false;
    }

    List<IPermissionUser> permissionUsers = CloudNet.getInstance().getPermissionManagement().getUsers(credentials[0]);
    IPermissionUser permissionUser = permissionUsers.stream()
      .filter(user -> user.checkPassword(credentials[1])).findFirst().orElse(null);

    if (permissionUser == null) {
      return false;
    }

    this.renewCookie(context, permissionUser);
    context.response().statusCode(200);
    return true;
  }

  public boolean isAuthorized(IHttpContext context) {
    IPermissionUser user = this.getUser(context);
    if (user == null) {
      if (context.hasCookie(COOKIE_NAME)) {
        this.logout(context);
      }
      return false;
    }

    this.renewCookie(context, user);
    return true;
  }

  public void logout(IHttpContext context) {
    Preconditions.checkNotNull(context);
    this.setCookie(context, "", 0);
  }

  public IPermissionUser getUser(IHttpContext context) {
    Preconditions.checkNotNull(context);

    HttpCookie cookie = context.cookie(COOKIE_NAME);
    if (cookie == null) {
      return null;
    }

    try {
      DecodedJWT token = this.verifier.verify(cookie.getValue());
      if (token.getSubject() == null || token.getIssuedAt() == null || token.getExpiresAt() == null) {
        return null;
      }
      return CloudNet.getInstance().getPermissionManagement().getUser(UUID.fromString(token.getSubject()));
    } catch (JWTVerificationException | IllegalArgumentException exception) {
      return null;
    }
  }

  private void renewCookie(IHttpContext context, IPermissionUser user) {
    Instant now = Instant.now();
    String token = JWT.create()
      .withIssuer(ISSUER)
      .withSubject(user.getUniqueId().toString())
      .withIssuedAt(now)
      .withExpiresAt(now.plusSeconds(EXPIRE_SECONDS))
      .sign(this.algorithm);
    this.setCookie(context, token, EXPIRE_SECONDS);
  }

  private void setCookie(IHttpContext context, String value, long maxAge) {
    HttpCookie cookie = new HttpCookie(COOKIE_NAME, value, null, "/", maxAge);
    cookie.setHttpOnly(true);
    context.addCookie(cookie);
  }

  private byte[] loadSigningKey() {
    try {
      if (Files.notExists(SIGNING_KEY_FILE)) {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        Files.createDirectories(SIGNING_KEY_FILE.getParent());
        try (Writer writer = Files.newBufferedWriter(SIGNING_KEY_FILE, StandardCharsets.UTF_8,
          StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
          new JsonDocument("signingKey", Base64.getEncoder().encodeToString(key)).write(writer);
        }
        return key;
      }

      String encodedKey = JsonDocument.newDocument(SIGNING_KEY_FILE).getString("signingKey");
      Preconditions.checkState(encodedKey != null, "Missing signingKey in %s", SIGNING_KEY_FILE);
      byte[] key = Base64.getDecoder().decode(encodedKey);
      Preconditions.checkState(key.length == 32, "Invalid signingKey in %s", SIGNING_KEY_FILE);
      return key;
    } catch (IOException exception) {
      throw new IllegalStateException("Unable to create REST session signing key at " + SIGNING_KEY_FILE, exception);
    }
  }
}
