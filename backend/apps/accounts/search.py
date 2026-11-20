from rest_framework.filters import SearchFilter


class FieldSearchFilter(SearchFilter):
    """Normal search, plus ``?search_in=<field>`` to look in one field only.

    Only fields the view already lists in ``search_fields`` can be chosen, so
    a caller can't search a column the view never meant to expose. An unknown
    ``search_in`` is ignored and the search covers every field as before.
    """

    search_in_param = "search_in"

    def get_search_fields(self, view, request):
        fields = list(super().get_search_fields(view, request) or [])
        wanted = request.query_params.get(self.search_in_param, "").strip()
        if not wanted:
            return fields
        for f in fields:
            if f.lstrip("^=@$") == wanted:
                return [f]
        return fields
