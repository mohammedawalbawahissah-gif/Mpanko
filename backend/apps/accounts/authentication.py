from rest_framework_simplejwt.authentication import JWTAuthentication

SHOP_SCOPE = "shop"


class ScopedJWTAuthentication(JWTAuthentication):
    """
    A staff member who signs in to the shop (customer website or app) gets a token marked scope="shop". It is
    skipped past the authenticator-code step because it carries no back-office power: for the whole request the
    user counts as a plain customer to every staff permission check. Signing in to the admin dashboard or admin app
    still needs the code and yields an ordinary token.
    """

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        user.shop_scope = validated_token.get("scope") == SHOP_SCOPE
        return user
