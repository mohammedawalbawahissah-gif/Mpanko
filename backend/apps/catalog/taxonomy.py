"""
The starting shelves of the shop: departments (top-level categories) and the sub-categories inside each.

Staff can rename, hide or add to these in the admin; `python manage.py seed_categories` only creates what is
missing and never changes or removes anything staff have already edited. Names must be unique across the whole
tree because a category's web address (slug) comes from its name.
"""

# (department, [sub-categories]). The order here is the order shoppers see.
TAXONOMY: list[tuple[str, list[str]]] = [
    ("Food", ["Grains and Cereals", "Spices and Seasonings", "Cooking Oils", "Sauces and Condiments", "Snacks and Sweets", "Nuts and Seeds", "Dried Fruit and Vegetables", "Flours and Baking", "Fish and Meat"]),
    ("Beverages", ["Tea and Herbal Infusions", "Coffee and Cocoa", "Juices and Soft Drinks", "Wine and Spirits", "Water and Energy Drinks"]),
    ("Fashion", ["Women's Fashion", "Men's Fashion", "Children's Fashion", "Traditional Wear", "Footwear", "Underwear and Sleepwear"]),
    ("Textiles", ["Kente and Woven Cloth", "Wax Print and Ankara", "Batik and Tie-dye", "Lace and Embroidery", "Yarn and Thread"]),
    ("Art", ["Paintings", "Sculpture and Carvings", "Beadwork", "Pottery and Ceramics", "Masks and Cultural Pieces", "Prints and Photography"]),
    ("Furniture", ["Living Room Furniture", "Bedroom Furniture", "Office Furniture", "Outdoor Furniture", "Stools and Chairs", "Shelving and Storage"]),
    ("Electronics", ["Phones and Tablets", "Computers and Laptops", "Audio and Headphones", "Cameras and Video", "TVs and Home Entertainment", "Solar and Power", "Phone and Computer Accessories", "Smart Home"]),
    ("Accessories", ["Bags and Purses", "Jewellery", "Watches and Sunglasses", "Hats and Scarves", "Belts and Wallets"]),
    ("Beauty", ["Shea and Body Butters", "Skin Care", "Hair Care", "Soaps and Bath", "Fragrance", "Makeup"]),
    ("Home", ["Baskets and Storage", "Kitchenware", "Home Decor", "Bedding and Linen", "Lighting", "Cleaning and Laundry"]),
    ("Books", ["Fiction", "Non-fiction", "Children's Books", "Textbooks and Study", "Stationery and Office Supplies"]),
    ("Raw Materials", ["Agricultural Produce", "Shea Nuts and Cocoa Beans", "Timber and Wood", "Minerals and Metals", "Cotton and Natural Fibres", "Bulk Oils and Butters", "Packaging Materials"]),
    ("Cars", ["Passenger Cars", "Motorcycles and Tricycles", "Vans and Trucks", "Auto Parts", "Tyres and Wheels", "Car Accessories"]),
    ("Farming", ["Seeds and Seedlings", "Fertilisers and Crop Care", "Farm Tools", "Farm Machinery", "Animal Feed"]),
    ("Building", ["Hand and Power Tools", "Building Materials", "Electrical Supplies", "Plumbing", "Paint and Finishes"]),
    ("Health", ["Herbal and Traditional", "Vitamins and Supplements", "First Aid and Care", "Fitness"]),
    ("Music", ["Drums and Percussion", "String Instruments", "Wind Instruments", "Recordings"]),
    ("Kids", ["Toys and Games", "Baby Care", "School Supplies"]),
]
