const mongoose = require('mongoose');
const V = new mongoose.Schema({ tenant_id:{type:String,required:true,index:true}, name:{type:String,required:true},
  gstin:String, pan:String, msme_registered:{type:Boolean,default:false}, msme_number:String,
  tds_category:{type:String,enum:['contractor','professional','technical_services','rent_plant','rent_land_building','commission','none'],default:'none'},
  status:{type:String,enum:['approved','pending','blacklisted','inactive'],default:'pending',index:true},
  email:String, phone:String, address:{line1:String,city:String,state:String,state_code:String,pincode:String,country:{type:String,default:'India'}},
  bank:{name:String,account_number:String,ifsc:String},
  on_time_rate:{type:Number,default:100}, invoice_accuracy:{type:Number,default:100},
  dispute_count:{type:Number,default:0}, avg_payment_days:{type:Number,default:30},
  last_invoice_date:Date, annual_spend:{type:Number,default:0}
},{timestamps:true});
V.index({tenant_id:1,gstin:1});
const C = new mongoose.Schema({ tenant_id:{type:String,required:true,index:true}, name:{type:String,required:true},
  gstin:String, pan:String, status:{type:String,enum:['active','inactive','blacklisted'],default:'active'},
  segment:{type:String,enum:['enterprise','mid_market','sme','retail']}, email:String, phone:String,
  billing_address:{line1:String,city:String,state:String,pincode:String},
  credit_limit:{type:Number,default:0}, credit_days:{type:Number,default:30},
  payment_score:{type:Number,default:100}, avg_order_value:{type:Number,default:0},
  churn_risk:{type:String,enum:['low','medium','high'],default:'low'}, lifetime_value:{type:Number,default:0}
},{timestamps:true});
const E = new mongoose.Schema({ tenant_id:{type:String,required:true,index:true},
  employee_id:{type:String,required:true}, name:{type:String,required:true},
  email:String, phone:String, department:String, designation:String, grade:String,
  manager_id:{type:mongoose.Schema.Types.ObjectId,ref:'Employee'},
  date_of_joining:Date, date_of_leaving:Date,
  status:{type:String,enum:['active','inactive','on_leave','resigned'],default:'active'},
  pan:String, uan:String, bank:{name:String,account_number:String,ifsc:String},
  salary:{basic:Number,hra:Number,special_allowance:Number,gross:Number,ctc:Number},
  tds_regime:{type:String,enum:['old','new'],default:'new'},
  performance_score:{type:Number,default:3}, leave_balance:{type:Map,of:Number}
},{timestamps:true});
E.index({tenant_id:1,employee_id:1},{unique:true});
const I = new mongoose.Schema({ tenant_id:{type:String,required:true,index:true},
  code:{type:String,required:true}, name:{type:String,required:true},
  type:{type:String,enum:['raw_material','semi_finished','finished','service','asset'],default:'finished'},
  hsn_sac:String, uom:{type:String,default:'Nos'}, gst_rate:{type:Number,default:18},
  current_stock:{type:Number,default:0}, reorder_level:{type:Number,default:0},
  reorder_quantity:{type:Number,default:0}, standard_cost:Number, last_purchase_price:Number,
  demand_forecast_30d:Number, stockout_risk:{type:String,enum:['low','medium','high'],default:'low'}
},{timestamps:true});
I.index({tenant_id:1,code:1},{unique:true});
module.exports = { VendorModel:mongoose.model('Vendor',V), CustomerModel:mongoose.model('Customer',C),
  EmployeeModel:mongoose.model('Employee',E), ItemModel:mongoose.model('Item',I) };
