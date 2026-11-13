from django.urls import path

from . import views

urlpatterns = [
    path("me/export/", views.export_me, name="export-me"),
    path("me/delete/", views.delete_me, name="delete-me"),
    path("consents/", views.consents, name="consents"),
    path("pages/", views.page_list, name="page-list"),
    path("pages/<slug:slug>/", views.page_detail, name="page-detail"),
]
