	var dclhandler = false;

	if (document.readyState !== 'loading') {
		init_all();
	} else {
		dclhandler = true;
		document.addEventListener('DOMContentLoaded', init_all);
	}

	function init_all(){
		changeElement();
	}

	function changeElement() {
		var txt = document.getElementById("demo");
		if(txt){
			var text = txt.firstChild;
			text.appendData('Text Changed');
		}
	}