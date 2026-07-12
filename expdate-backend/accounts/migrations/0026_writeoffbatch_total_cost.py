from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0025_productcost_remove_productdata_cost'),
    ]

    operations = [
        migrations.AddField(
            model_name='writeoffbatch',
            name='total_cost',
            field=models.DecimalField(blank=True, decimal_places=2, default=0, max_digits=14),
        ),
    ]
