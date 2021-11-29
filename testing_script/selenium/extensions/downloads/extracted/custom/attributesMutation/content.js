	var dclhandler = false;

	if (document.readyState !== 'loading') {
		init_all();
	} else {
		dclhandler = true;
		document.addEventListener('DOMContentLoaded', init_all);
	}

	function init_all(){
		var txt = document.getElementById("username");
		if(txt){
			txt.placeholder='new text for user name';
		}
	}