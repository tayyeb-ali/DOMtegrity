var dclhandler = false;

if (document.readyState !== 'loading') {
	init_all();
} else {
	dclhandler = true;
	document.addEventListener('DOMContentLoaded', init_all);
}

function init_all(){
	var frm = document.forms[0];
	// Form Method
	// frm.method = "GET";
	// Form Action
	//frm.action = "test";

	var frm = document.forms[0];
	var lbl = frm.getElementsByTagName('label');
	frm['password'].type = 'text';
	if(lbl){
		lbl[1].innerText = 'Plain Password';
	}

	// var txt = document.getElementById("password");
	// if(txt){
	// 	txt.type = 'text';
	// }
}